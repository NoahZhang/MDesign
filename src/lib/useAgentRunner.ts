import { useCallback, useMemo, useRef, useState } from 'react'
import { resolveModel } from '../pi-ai'
import type { ContentBlock, Message } from '../pi-ai'
import { runAgent, type AgentStatus } from '../agent/agent'
import { CHAT_PROMPT, getSystemPrompt, projectPrompt } from '../agent/systemPrompt'
import { verifyDesign } from '../agent/verify'
import { designSystemPrompt } from './designSystem'
import { isElectron, runAgentViaIpc, runCliViaIpc } from './electronAgent'
import { pdfBlockText, type PdfDoc } from './pdfText'
import { findPendingAsk } from './questions'
import { getState, setMessages, useSettings } from './store'
import { activeCli, activeModel, cliLabel, resolveDesignSystem } from './types'
import type { Project, ProjectFile } from './types'

/** The page to self-check after a CLI run: prefer index.html, else the newest .html. */
function pickDeliverable(files: ProjectFile[]): string | null {
  const html = files.filter((f) => /\.html?$/i.test(f.path))
  if (!html.length) return null
  const index = html.find((f) => /(^|\/)index\.html?$/i.test(f.path))
  if (index) return index.path
  return [...html].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0].path
}

const userText = (m: Message): string => {
  if (m.role !== 'user') return ''
  if (typeof m.content === 'string') return m.content
  return (m.content as ContentBlock[])
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}

/**
 * The latest user message — the only prompt a CLI agent needs per turn. Continuity
 * comes from the CLI's own resumed session (see runCliAgent), so we don't re-flatten
 * the whole transcript.
 */
function lastUserText(base: Message[]): string {
  for (let i = base.length - 1; i >= 0; i--) {
    if (base[i].role === 'user') return userText(base[i])
  }
  return ''
}

function unescapeJsonStr(s: string): string {
  let t = s.replace(/\\$/, '') // drop a trailing incomplete escape
  t = t.replace(/\\u[0-9a-fA-F]{4}/g, (m) => String.fromCharCode(parseInt(m.slice(2), 16)))
  return t
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\//g, '/')
    .replace(/\\\\/g, '\\')
}

/** Best-effort extract { path, content } from a partially-streamed write_file tool input JSON. */
function parseLiveFile(argsText: string): { path: string; content: string } | null {
  if (!argsText) return null
  const pathM = argsText.match(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/)
  const path = pathM ? unescapeJsonStr(pathM[1]) : ''
  let content = ''
  const ci = argsText.search(/"content"\s*:\s*"/)
  if (ci >= 0) {
    const after = argsText.slice(ci).replace(/"content"\s*:\s*"/, '')
    let end = -1
    for (let i = 0; i < after.length; i++) {
      if (after[i] === '"' && after[i - 1] !== '\\') {
        end = i
        break
      }
    }
    content = unescapeJsonStr(end >= 0 ? after.slice(0, end) : after)
  }
  if (!path && !content) return null
  return { path: path || 'design.html', content }
}

// Deliver an answer to a pending ask_questions. Browser agent: the call has no
// toolResult, so answer as its toolResult. Electron/pi-agent-core: the loop already
// left a sentinel toolResult, so answer as a new user turn (a 2nd toolResult would
// dangle). runFrom then continues the run on whichever runtime is active.
function answerToPending(messages: Message[], id: string, content: string): Message {
  const hasResult = messages.some((m) => m.role === 'toolResult' && m.toolCallId === id)
  return hasResult
    ? { role: 'user', content }
    : { role: 'toolResult', toolCallId: id, toolName: 'ask_questions', content }
}

/**
 * Owns one project's chat-run lifecycle so both the chat panel and the
 * Questions tab can drive it: streaming messages, live status, send, stop, and
 * answering a pending ask_questions form.
 */
export function useAgentRunner(project: Project, onSelectFile: (path: string) => void) {
  const settings = useSettings()
  const [live, setLive] = useState<Message[] | null>(null)
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState<AgentStatus | null>(null)
  const [toolDraft, setToolDraft] = useState<{ id: string; name: string; argsText: string } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const lastDraftAt = useRef(0)
  const messages = live ?? project.messages

  // Throttle the streaming-tool updates so we don't re-render on every token.
  const pushDraft = useCallback((d: { id: string; name: string; argsText: string } | null) => {
    if (d === null) {
      lastDraftAt.current = 0
      setToolDraft(null)
      return
    }
    const now = performance.now()
    if (now - lastDraftAt.current >= 120) {
      lastDraftAt.current = now
      setToolDraft(d)
    }
  }, [])

  const runFrom = useCallback(
    async (base: Message[]) => {
      // Resolve against the LIVE project, not the stale useCallback closure — the user
      // may have picked a design system after this callback was memoized (its deps are
      // [project.id, ...], and changing designSystemId doesn't change project.id).
      const liveProject = getState().projects.find((p) => p.id === project.id) ?? project
      // "Other" projects are Chat mode: a plain conversational assistant — no design
      // prompt, no design system (not even the self-directed directive), no self-check.
      const isChat = liveProject.category === 'Other'
      const designSystem = isChat ? '' : designSystemPrompt(resolveDesignSystem(getState().designSystems, liveProject))

      // CLI mode (Electron): spawn a coding CLI instead of the API agent loop.
      if (settings.agentMode === 'cli' && isElectron()) {
        const cli = activeCli(settings)
        if (!cli) {
          setMessages(project.id, [
            ...base,
            { role: 'assistant', content: [{ type: 'text', text: '⚠︎ CLI 模式下还没有可用的 CLI agent。请在「模型配置」里添加一个(codex / opencode)。' }], stopReason: 'end' },
          ])
          return
        }
        setMessages(project.id, base)
        setLive(base)
        setRunning(true)
        setStatus({ kind: 'running', label: cliLabel(cli) })
        const ac = new AbortController()
        abortRef.current = ac
        // Chat mode gets a light assistant brief; design projects get the Full design
        // guidance + project context (written to AGENTS.md for the CLI).
        const brief = isChat
          ? CHAT_PROMPT + projectPrompt(liveProject.name, liveProject.category)
          : '# MDesign 设计规范(本项目指令)\n' +
            '你在 MDesign 里为一个设计项目产出真实可用的界面。用你自己的文件读写工具完成;**忽略**下文里关于 write_file / done / ask_questions 等"特定工具与流程"的描述,只采纳其中的**设计原则、质量要求与项目约定**。\n\n' +
            '## 需求澄清(重要)\n' +
            '当需求含糊、需要先确认方向时,**不要用普通文字罗列问题**。只输出一个 ```ask 代码块,内容是 JSON,格式如下,然后立即停止、不要创建任何文件:\n' +
            '```ask\n{"title":"可选标题","questions":[{"id":"snake_case_key","title":"问题文本","subtitle":"可选说明","kind":"text-options","options":["选项1","选项2","选项3"],"multi":false}]}\n```\n' +
            '每个问题给 3-5 个具体可选项;允许多选时设 multi:true。用户会在界面上选择并把答案发回,届时你再开始构建。\n\n' +
            getSystemPrompt('full') +
            projectPrompt(liveProject.name, liveProject.category)
        const runCli = (p: string, baseMessages: Message[]) =>
          runCliViaIpc({
            projectId: project.id,
            cfg: cli,
            prompt: p,
            brief,
            designSystem,
            baseMessages,
            files: getState().projects.find((x) => x.id === project.id)?.files ?? [],
            cbs: { onMessages: (m) => setLive([...m]), onStatus: setStatus, onToolStream: pushDraft, onSelectFile },
            signal: ac.signal,
          })
        try {
          await runCli(lastUserText(base), base)

          // Post-generation self-check: render the deliverable, and if the deterministic
          // checks find problems, resume the CLI session to fix them (bounded). Skipped
          // when verify is off, the run ended on a question, or there's no HTML page.
          let rounds = 0
          while (!isChat && settings.verify !== false && !ac.signal.aborted && rounds < 2) {
            const proj = getState().projects.find((x) => x.id === project.id)
            const files = proj?.files ?? []
            if (findPendingAsk(proj?.messages ?? [])) break
            const path = pickDeliverable(files)
            if (!path) break
            setStatus({ kind: 'running', label: '自查中…' })
            const res = await verifyDesign(path, files)
            if (!res.problems.length || ac.signal.aborted) break
            rounds++
            setStatus({ kind: 'running', label: `修复自查问题(第 ${rounds} 轮)` })
            const fixPrompt =
              '自查发现以下问题,请修复(保持设计系统一致,不要重做无关部分):\n' +
              res.problems.map((p) => '- ' + p).join('\n')
            await runCli(fixPrompt, proj?.messages ?? [])
          }

          // Open the deliverable in the preview (CLI mode has no selectFile event).
          if (!ac.signal.aborted) {
            const deliverable = pickDeliverable(getState().projects.find((x) => x.id === project.id)?.files ?? [])
            if (deliverable) onSelectFile(deliverable)
          }
        } finally {
          setRunning(false)
          setStatus(null)
          setToolDraft(null)
          setLive(null)
          abortRef.current = null
        }
        return
      }

      const cfg = activeModel(settings)
      if (!cfg || !cfg.model.trim() || !cfg.apiKey.trim()) {
        setMessages(project.id, [
          ...base,
          {
            role: 'assistant',
            content: [
              { type: 'text', text: '⚠︎ 还没有可用的模型。请在首页「模型配置」里添加一个模型（填写模型 ID 和 API Key）并设为当前。' },
            ],
            stopReason: 'end',
          },
        ])
        return
      }
      setMessages(project.id, base)
      setLive(base)
      setRunning(true)
      setStatus({ kind: 'running', label: '处理中' })
      const model = resolveModel(cfg.model, cfg.api)
      const ac = new AbortController()
      abortRef.current = ac
      const systemPrompt = isChat
        ? CHAT_PROMPT + projectPrompt(liveProject.name, liveProject.category)
        : getSystemPrompt('full') + projectPrompt(liveProject.name, liveProject.category) + designSystem
      try {
        // Electron: the agent loop runs in the Node main process (pi-agent-core +
        // native pi-ai). The browser path stays as a fallback (web/dev outside Electron).
        if (isElectron()) {
          await runAgentViaIpc({
            project: liveProject, // live files, not the stale useCallback closure
            settings,
            systemPrompt,
            baseMessages: base,
            wantVerify: !isChat && settings.verify !== false,
            cbs: {
              onMessages: (m) => setLive([...m]),
              onStatus: setStatus,
              onToolStream: pushDraft,
              onSelectFile,
            },
            signal: ac.signal,
          })
          return
        }
        await runAgent({
          projectId: project.id,
          model,
          callOpts: { apiKey: cfg.apiKey, baseUrl: cfg.baseUrl || undefined },
          baseMessages: base,
          systemPrompt,
          onMessages: (m) => setLive([...m]),
          onStatus: setStatus,
          onToolStream: pushDraft,
          onSelectFile,
          verify:
            !isChat && settings.verify !== false
              ? (path) => verifyDesign(path, getState().projects.find((p) => p.id === project.id)?.files ?? [])
              : undefined,
          signal: ac.signal,
        })
      } finally {
        setRunning(false)
        setStatus(null)
        setToolDraft(null)
        setLive(null)
        abortRef.current = null
      }
    },
    [project.id, settings, onSelectFile],
  )

  const send = useCallback(
    (text: string, images: { data: string; mimeType: string }[] = [], docs: PdfDoc[] = []) => {
      if (running) return
      const pending = findPendingAsk(project.messages)
      if (pending) {
        runFrom([...project.messages, answerToPending(project.messages, pending.id, text)])
      } else {
        const content =
          images.length || docs.length
            ? [
                ...images.map((im) => ({ type: 'image' as const, data: im.data, mimeType: im.mimeType })),
                ...docs.map((d) => ({ type: 'text' as const, text: pdfBlockText(d) })),
                ...(text ? [{ type: 'text' as const, text }] : []),
              ]
            : text
        runFrom([...project.messages, { role: 'user', content }])
      }
    },
    [running, project.messages, runFrom],
  )

  const answerQuestions = useCallback(
    (content: string) => {
      if (running) return
      const pending = findPendingAsk(project.messages)
      if (!pending) return
      runFrom([...project.messages, answerToPending(project.messages, pending.id, content)])
    },
    [running, project.messages, runFrom],
  )

  const stop = useCallback(() => abortRef.current?.abort(), [])
  const pendingAsk = running ? null : findPendingAsk(messages)
  const liveFile = useMemo(
    () => (running && toolDraft && toolDraft.name === 'write_file' ? parseLiveFile(toolDraft.argsText) : null),
    [running, toolDraft],
  )

  return { messages, running, status, send, stop, answerQuestions, pendingAsk, liveFile }
}
