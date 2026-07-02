// Main-process agent runtime (Electron main / Node). Drives pi-agent-core's loop
// with native pi-ai transport, the project's tools, verify round-trip, and
// (Stage 1b) context compaction. UI updates funnel through `emit` (→ IPC).
import {
  DEFAULT_COMPACTION_SETTINGS,
  estimateContextTokens,
  estimateTokens,
  runAgentLoopContinue,
  shouldCompact,
} from '@earendil-works/pi-agent-core'
import type { AgentEvent, AgentLoopConfig, AgentMessage, AgentTool } from '@earendil-works/pi-agent-core'
import type { Message as PiMessage } from '@earendil-works/pi-ai'
import { Type } from 'typebox'

const SUMMARY_PROMPT =
  '你是上下文压缩助手。阅读下面这段用户与设计助手的对话,输出一段结构化中文摘要:用户的目标与偏好、已确定的设计决策、已创建/修改的文件及其要点、尚未完成的事项。不要续写对话、不要回答其中的问题,只输出摘要。'
import type { Project, ProjectFile, Settings } from '../lib/types'
import type { Message as AppMessage } from '../pi-ai/types'
import { toApp, toPi } from './map'
import { buildTransport } from './transport'

// Inlined (avoid importing src/lib/types at runtime — it pulls browser-side modules).
function contentTypeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    html: 'text/html', htm: 'text/html', jsx: 'text/jsx', tsx: 'text/tsx',
    js: 'text/javascript', ts: 'text/typescript', css: 'text/css', json: 'application/json',
    svg: 'image/svg+xml', md: 'text/markdown', txt: 'text/plain',
  }
  return map[ext] ?? 'text/plain'
}

export interface Emit {
  messages(appMessages: AppMessage[]): void
  files(files: ProjectFile[]): void
  status(s: { kind: string; label: string } | null): void
  toolStream(t: { id: string; name: string; argsText: string } | null): void
  selectFile(path: string): void
}
export type VerifyFn = (path: string, files: ProjectFile[]) => Promise<{ problems: string[]; screenshot?: string }>

export interface RunArgs {
  project: Project
  settings: Settings
  systemPrompt: string // assembled by the renderer (handles ?raw prompt + design system)
  baseMessages: AppMessage[]
  emit: Emit
  verify?: VerifyFn
  signal?: AbortSignal
}

const textResult = (text: string, details: unknown = {}, terminate = false) => ({
  content: [{ type: 'text' as const, text }],
  details,
  terminate,
})

const STATUS: Record<string, string> = {
  write_file: '写文件', str_replace_edit: '编辑', read_file: '读取', list_files: '列目录',
  delete_file: '删除', ask_questions: '提问', done: '完成',
}

export async function runAgent(args: RunArgs): Promise<void> {
  const { project, settings, systemPrompt, baseMessages, emit, verify, signal } = args

  // in-memory project files the tools mutate; flushed to the renderer on change.
  const files = new Map<string, ProjectFile>()
  for (const f of project.files) files.set(f.path, { ...f })
  const snapshot = (): ProjectFile[] => [...files.values()]
  const setFile = (path: string, content: string) => {
    const created = !files.has(path)
    files.set(path, { path, content, contentType: contentTypeFor(path), updatedAt: 0 })
    emit.files(snapshot())
    return created
  }

  // done → verify round-trip; clean render's screenshot triggers one visual review.
  let verifyRounds = 0
  let screenshotSent = false
  let pendingShot: { mimeType: string; data: string } | null = null

  const tools: AgentTool[] = [
    {
      name: 'write_file', label: 'write_file',
      description:
        'Create or overwrite a design file. Use .html for pages/prototypes, .jsx/.tsx for components.',
      parameters: Type.Object({ path: Type.String(), content: Type.String() }),
      execute: async (_id, p: any) => {
        const path = String(p.path ?? '').trim()
        if (!path) return textResult('write_file requires a path.')
        const created = setFile(path, String(p.content ?? ''))
        emit.selectFile(path)
        return textResult(`${created ? 'Created' : 'Updated'} ${path}.`)
      },
    },
    {
      name: 'read_file', label: 'read_file',
      description: 'Read the contents of a project file.',
      parameters: Type.Object({ path: Type.String() }),
      execute: async (_id, p: any) => {
        const f = files.get(String(p.path))
        return f ? textResult(f.content.slice(0, 8000)) : textResult(`No such file: ${p.path}`)
      },
    },
    {
      name: 'list_files', label: 'list_files',
      description: 'List files in the project (optionally under a folder prefix).',
      parameters: Type.Object({ path: Type.Optional(Type.String()) }),
      execute: async (_id, p: any) => {
        const prefix = String(p.path ?? '')
        const list = snapshot().filter((f) => f.path.startsWith(prefix)).map((f) => f.path).join('\n')
        return textResult(list || '(empty)')
      },
    },
    {
      name: 'str_replace_edit', label: 'str_replace_edit',
      description: 'Replace an exact substring in a file. old_string must occur exactly once.',
      parameters: Type.Object({ path: Type.String(), old_string: Type.String(), new_string: Type.String() }),
      execute: async (_id, p: any) => {
        const f = files.get(String(p.path))
        if (!f) return textResult(`No such file: ${p.path}`)
        const idx = f.content.indexOf(String(p.old_string))
        if (idx < 0) return textResult(`Could not edit ${p.path}: old_string not found.`)
        setFile(f.path, f.content.replace(String(p.old_string), String(p.new_string)))
        emit.selectFile(f.path)
        return textResult(`Edited ${p.path}.`)
      },
    },
    {
      name: 'delete_file', label: 'delete_file',
      description: 'Delete one or more files or folders from the project.',
      parameters: Type.Object({ paths: Type.Array(Type.String()) }),
      execute: async (_id, p: any) => {
        const paths: string[] = Array.isArray(p.paths) ? p.paths.map(String) : []
        for (const path of paths) for (const k of [...files.keys()]) if (k === path || k.startsWith(path + '/')) files.delete(k)
        emit.files(snapshot())
        return textResult(`Deleted: ${paths.join(', ')}`)
      },
    },
    {
      name: 'ask_questions', label: 'ask_questions',
      description:
        'Ask the user a short round of clarifying questions, rendered as an interactive form. Use BEFORE building when ambiguous. After calling it, end your turn.',
      parameters: Type.Object({
        title: Type.Optional(Type.String()),
        questions: Type.Array(
          Type.Object({
            id: Type.String(), title: Type.String(), subtitle: Type.Optional(Type.String()),
            kind: Type.Optional(Type.String()), options: Type.Optional(Type.Array(Type.String())),
            multi: Type.Optional(Type.Boolean()),
          }),
        ),
      }),
      // Pause the loop: the renderer renders the form and re-runs with the answers.
      execute: async () => textResult('Awaiting user answers.', {}, true),
    },
    {
      name: 'done', label: 'done',
      description: 'Finish the turn and open a file in the preview pane. Call once the deliverable is ready.',
      parameters: Type.Object({ path: Type.String() }),
      execute: async (_id, p: any) => {
        const path = p.path ? String(p.path) : ''
        if (path) emit.selectFile(path)
        if (verify && verifyRounds < 2 && !signal?.aborted) {
          verifyRounds++
          emit.status({ kind: 'running', label: '自检中' })
          try {
            const res = await verify(path, snapshot())
            if (res.problems.length) {
              return textResult(
                '自检渲染了该页面，发现以下问题，请逐一修复（用 str_replace_edit 或 write_file），然后再次调用 done：\n- ' +
                  res.problems.join('\n- '),
              )
            }
            const shot = res.screenshot?.match(/^data:([^;]+);base64,(.*)$/)
            if (shot && !screenshotSent) pendingShot = { mimeType: shot[1], data: shot[2] }
          } catch {
            /* verifier failure never blocks */
          }
        }
        return textResult('done')
      },
    },
  ]

  const t = buildTransport(activeModel(settings))

  const base: PiMessage[] = baseMessages.map(toPi)
  const accumulated: PiMessage[] = []
  let streaming: PiMessage | null = null
  const emitLive = () =>
    emit.messages([...base, ...accumulated, ...(streaming ? [streaming] : [])].map(toApp))

  const config: AgentLoopConfig = {
    model: t.model,
    ...t.options,
    convertToLlm: (ms: AgentMessage[]) => ms as PiMessage[],
    toolExecution: 'sequential',
    // Context compaction: when the transcript nears the model's window, summarize
    // the older turns and keep only the recent tail. This is the original goal of
    // the whole agent-runtime move ("上下文过长怎么办").
    transformContext: async (msgs: AgentMessage[], sig?: AbortSignal) => {
      const cs = DEFAULT_COMPACTION_SETTINGS
      const est = estimateContextTokens(msgs)
      if (!shouldCompact(est.tokens, t.model.contextWindow, cs)) return msgs
      // Keep the recent tail (~keepRecentTokens), starting at a clean user-turn boundary.
      let acc = 0
      let cut = 0
      for (let i = msgs.length - 1; i >= 0; i--) {
        acc += estimateTokens(msgs[i])
        if (acc >= cs.keepRecentTokens) { cut = i; break }
      }
      // Advance to a clean boundary: don't start the recent tail on a toolResult (that
      // would orphan it from its tool call). A build has only one user message, so
      // requiring role==='user' here made compaction never fire; assistant boundaries
      // are valid cut points.
      while (cut < msgs.length && (msgs[cut] as PiMessage).role === 'toolResult') cut++
      const older = msgs.slice(0, cut)
      const recent = msgs.slice(cut)
      if (older.length < 2 || recent.length === 0) return msgs
      try {
        emit.status({ kind: 'running', label: '压缩上下文' })
        const stream = t.streamFn(t.model, { systemPrompt: SUMMARY_PROMPT, messages: older as PiMessage[] }, { ...t.options, signal: sig })
        for await (const _ of stream) { /* drain */ }
        const summary = (await stream.result()).content.map((c) => (c.type === 'text' ? c.text : '')).join('')
        if (!summary.trim()) return msgs
        const summaryMsg = { role: 'user', content: `[此前对话的压缩摘要]\n${summary}`, timestamp: 0 } as PiMessage
        return [summaryMsg, ...recent]
      } catch {
        return msgs
      }
    },
    // After the model stops calling tools, inject the self-check screenshot once.
    getFollowUpMessages: async () => {
      if (pendingShot && !screenshotSent) {
        screenshotSent = true
        const shot = pendingShot
        pendingShot = null
        const shotMsg = {
          role: 'user',
          content: [
            { type: 'image', data: shot.data, mimeType: shot.mimeType },
            {
              type: 'text',
              text: '（自动自检）这是该页面渲染后的截图。请对照需求做一次视觉自查：布局、配色、字号层级、留白、对齐有无明显问题？有问题就直接修复并再次调用 done；没有问题就用一两句话确认收尾，不要重写页面。',
            },
          ],
          timestamp: 0,
        } as PiMessage
        // The loop adds follow-ups to its context but emits no event for them, so
        // mirror it into the displayed transcript ourselves (else the screenshot
        // is sent to the model but never shown in chat).
        accumulated.push(shotMsg)
        emitLive()
        return [shotMsg]
      }
      return []
    },
  }

  // Pass a COPY — the loop appends to context.messages in place; sharing `base`
  // would double every message (it's also the snapshot emitLive reads from).
  const context = { systemPrompt, messages: [...base], tools }

  // Live tool-call args accumulator → drives the right-panel "writing…" preview.
  let liveTool: { id: string; name: string; args: string } | null = null

  const sink = (ev: AgentEvent) => {
    switch (ev.type) {
      case 'turn_start':
        emit.status({ kind: 'running', label: '思考中' })
        break
      case 'message_start':
        streaming = ev.message as PiMessage
        emitLive()
        break
      case 'message_update': {
        streaming = ev.message as PiMessage
        // Stream the tool-call arguments as they're generated (so the right panel
        // shows the file being written live, not only the final result).
        const ame = ev.assistantMessageEvent
        if (ame?.type === 'toolcall_start') {
          const blk = ame.partial.content[ame.contentIndex] as { id?: string; name?: string } | undefined
          liveTool = { id: blk?.id ?? '', name: blk?.name ?? '', args: '' }
          if (liveTool.name) emit.toolStream({ id: liveTool.id, name: liveTool.name, argsText: '' })
        } else if (ame?.type === 'toolcall_delta' && liveTool) {
          liveTool.args += ame.delta
          emit.toolStream({ id: liveTool.id, name: liveTool.name, argsText: liveTool.args })
        }
        emitLive()
        break
      }
      case 'message_end':
        streaming = null
        if ((ev.message as PiMessage).role === 'assistant') accumulated.push(ev.message as PiMessage)
        emitLive()
        break
      case 'turn_end':
        for (const tr of ev.toolResults) accumulated.push(tr as PiMessage)
        emitLive()
        break
      case 'tool_execution_start':
        emit.status({ kind: 'tool', label: STATUS[ev.toolName] ?? ev.toolName })
        emit.toolStream({ id: ev.toolCallId, name: ev.toolName, argsText: JSON.stringify(ev.args ?? {}) })
        break
      case 'tool_execution_end':
        liveTool = null
        emit.toolStream(null)
        break
    }
  }

  emit.status({ kind: 'running', label: '思考中' })
  await runAgentLoopContinue(context, config, sink, signal, t.streamFn)
  emit.status(null)
  emit.toolStream(null)
}

function activeModel(s: Settings) {
  return s.models.find((m) => m.id === s.activeId) ?? s.models[0]
}
