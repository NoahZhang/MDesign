import { stream, trimImages } from '../pi-ai'
import type { AssistantMessage, CallOptions, ContentBlock, Context, Message, Model } from '../pi-ai'
import { setMessages } from '../lib/store'
import { SYSTEM_PROMPT } from './systemPrompt'
import { executeTool, TOOLS } from './tools'

// Safety backstop against runaway loops. With multi-file splitting each turn
// writes ~one file, so this must be high enough to build a whole design (the
// model normally calls `done` and stops well before hitting it).
const MAX_TURNS = 40

export interface AgentStatus {
  kind: 'thinking' | 'tool' | 'running'
  label: string
  tool?: string
}

function toolStatusLabel(name: string): string {
  switch (name) {
    case 'write_file':
      return '正在生成文件'
    case 'str_replace_edit':
      return '正在修改文件'
    case 'read_file':
      return '正在读取文件'
    case 'list_files':
      return '正在浏览文件'
    case 'ask_questions':
      return '正在准备问题'
    case 'done':
      return '正在完成'
    default:
      return `调用 ${name}`
  }
}

function kb(n: number): string {
  return n >= 1024 ? ` (${(n / 1024).toFixed(1)} KB)` : ''
}

export interface RunArgs {
  projectId: string
  model: Model
  callOpts: CallOptions
  /** Conversation so far, including the new user message. */
  baseMessages: Message[]
  /** System prompt to inject (defaults to the condensed designer prompt). */
  systemPrompt?: string
  /** Live view callback — fired as text streams and tools run. */
  onMessages: (messages: Message[]) => void
  /** Live activity status (thinking / writing file / running tool). null = idle. */
  onStatus?: (status: AgentStatus | null) => void
  /** Streaming tool input (e.g. a file being written), for live preview. null = none. */
  onToolStream?: (draft: { id: string; name: string; argsText: string } | null) => void
  onSelectFile?: (path: string) => void
  /** Post-`done` self-check: render the deliverable; problems are fed back for fixing
   *  (max 2 rounds), and a clean render's screenshot triggers one visual self-review. */
  verify?: (path: string) => Promise<{ problems: string[]; screenshot?: string }>
  signal?: AbortSignal
}

/**
 * One agentic run: stream a turn, execute any tool calls against the project
 * file system, feed results back, and repeat until the model stops asking for
 * tools (or calls `done`). Returns the final persisted message list.
 */
export async function runAgent(args: RunArgs): Promise<Message[]> {
  const { projectId, model, callOpts, baseMessages, onMessages, onStatus, onToolStream, onSelectFile, verify, signal } = args
  const systemPrompt = args.systemPrompt ?? SYSTEM_PROMPT
  const messages: Message[] = [...baseMessages]
  let verifyRounds = 0
  let screenshotSent = false

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (signal?.aborted) break
    onStatus?.({ kind: 'running', label: '处理中' })

    // Only the newest 2 images go out on the wire; the stored history keeps them all.
    const context: Context = { systemPrompt, messages: trimImages(messages), tools: TOOLS }
    const blocks: ContentBlock[] = []
    let pending = '' // streaming text not yet finalized
    let curTool = ''
    let curToolId = ''
    let curArgs = ''
    let toolBytes = 0
    const draft: AssistantMessage = { role: 'assistant', content: [], stopReason: 'end' }

    const pushView = () => {
      draft.content = pending ? [...blocks, { type: 'text', text: pending }] : [...blocks]
      onMessages([...messages, draft])
    }

    let reason: AssistantMessage['stopReason'] = 'end'
    pushView()

    try {
      for await (const ev of stream(model, context, { ...callOpts, signal })) {
        switch (ev.type) {
          case 'thinking_start':
            onStatus?.({ kind: 'thinking', label: '思考中' })
            break
          case 'text_start':
            pending = ''
            onStatus?.({ kind: 'running', label: '回复中' })
            break
          case 'text_delta':
            pending += ev.delta
            pushView()
            break
          case 'text_end':
            if (pending) blocks.push({ type: 'text', text: pending })
            pending = ''
            pushView()
            break
          case 'toolcall_start':
            curTool = ev.name
            curToolId = ev.id
            curArgs = ''
            toolBytes = 0
            onStatus?.({ kind: 'tool', label: toolStatusLabel(ev.name), tool: ev.name })
            onToolStream?.({ id: ev.id, name: ev.name, argsText: '' })
            break
          case 'toolcall_delta':
            toolBytes += ev.argsTextDelta.length
            curArgs += ev.argsTextDelta
            onStatus?.({ kind: 'tool', label: toolStatusLabel(curTool) + kb(toolBytes), tool: curTool })
            onToolStream?.({ id: curToolId, name: curTool, argsText: curArgs })
            break
          case 'toolcall_end':
            blocks.push({ type: 'toolCall', id: ev.toolCall.id, name: ev.toolCall.name, input: ev.toolCall.input })
            onToolStream?.(null)
            pushView()
            break
          case 'usage':
            draft.usage = ev.usage
            break
          case 'done':
            reason = ev.reason
            break
          case 'error':
            blocks.push({ type: 'text', text: `⚠︎ ${ev.error}` })
            reason = 'error'
            pushView()
            break
        }
      }
    } catch (err: any) {
      if (signal?.aborted) break
      blocks.push({ type: 'text', text: `⚠︎ ${err?.message ?? String(err)}` })
      reason = 'error'
    }

    if (pending) {
      blocks.push({ type: 'text', text: pending })
      pending = ''
    }
    draft.content = [...blocks]
    draft.stopReason = reason
    messages.push(draft)
    onMessages([...messages])

    const toolCalls = blocks.filter((b): b is Extract<ContentBlock, { type: 'toolCall' }> => b.type === 'toolCall')

    // No tool calls -> the model is done (or its text was truncated). Stop.
    if (toolCalls.length === 0) break
    // Execute tool calls regardless of stop reason. A turn can end with
    // stop_reason 'max_tokens' mid tool-call; we must still answer every
    // tool_use or the next request has a dangling tool_use and the provider 400s.

    let stop = false
    let awaitingAnswers = false
    for (const call of toolCalls) {
      // ask_questions pauses the run: leave its tool call unanswered so the UI
      // can render a form. Other tools in the same turn still execute.
      if (call.name === 'ask_questions') {
        awaitingAnswers = true
        continue
      }
      const outcome = executeTool(projectId, call.name, call.input)

      // `done` → run the self-check on the deliverable. Problems go back as the tool
      // result so the model fixes them and calls done again (bounded to 2 rounds);
      // a clean render's screenshot triggers one visual self-review pass.
      if (call.name === 'done' && verify && verifyRounds < 2 && !signal?.aborted) {
        verifyRounds++
        onStatus?.({ kind: 'running', label: '自检中' })
        let res: { problems: string[]; screenshot?: string } = { problems: [] }
        try {
          res = await verify(String((call.input as Record<string, unknown>)?.path ?? ''))
        } catch {
          /* verifier failure must never block the run */
        }
        if (res.problems.length) {
          messages.push({
            role: 'toolResult',
            toolCallId: call.id,
            toolName: call.name,
            content:
              '自检渲染了该页面，发现以下问题，请逐一修复（用 str_replace_edit 或 write_file），然后再次调用 done：\n- ' +
              res.problems.join('\n- '),
          })
          onMessages([...messages])
          if (outcome.selectFile) onSelectFile?.(outcome.selectFile)
          continue
        }
        const shot = res.screenshot?.match(/^data:([^;]+);base64,(.*)$/)
        if (shot && !screenshotSent) {
          screenshotSent = true
          messages.push({
            role: 'toolResult',
            toolCallId: call.id,
            toolName: call.name,
            content: outcome.result,
          })
          messages.push({
            role: 'user',
            content: [
              { type: 'image', mimeType: shot[1], data: shot[2] },
              {
                type: 'text',
                text: '（自动自检）这是该页面渲染后的截图。请对照需求做一次视觉自查：布局、配色、字号层级、留白、对齐是否有明显问题？有问题就直接修复并再次调用 done；没有问题就用一两句话确认收尾，不要重写页面。',
              },
            ],
          })
          onMessages([...messages])
          if (outcome.selectFile) onSelectFile?.(outcome.selectFile)
          continue
        }
      }

      messages.push({
        role: 'toolResult',
        toolCallId: call.id,
        toolName: call.name,
        content: outcome.result,
        isError: outcome.isError,
      })
      onMessages([...messages])
      if (outcome.selectFile) onSelectFile?.(outcome.selectFile)
      if (call.name === 'done') stop = true
    }

    setMessages(projectId, messages)
    if (awaitingAnswers || stop || signal?.aborted) break
  }

  onStatus?.(null)
  onToolStream?.(null)
  setMessages(projectId, messages)
  return messages
}
