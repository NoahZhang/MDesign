import { sseEvents } from '../sse'
import type { CallOptions, Context, Message, Model, StopReason, StreamEvent } from '../types'

const DEFAULT_BASE = '/llm/openai'

function mapFinish(reason: string | null | undefined): StopReason {
  switch (reason) {
    case 'tool_calls':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    case 'content_filter':
      return 'stop_sequence'
    default:
      return 'end'
  }
}

function toOpenAIMessages(context: Context): unknown[] {
  const out: unknown[] = []
  if (context.systemPrompt) out.push({ role: 'system', content: context.systemPrompt })
  for (const m of context.messages as Message[]) {
    if (m.role === 'user') {
      if (typeof m.content === 'string') {
        out.push({ role: 'user', content: m.content })
      } else {
        out.push({
          role: 'user',
          content: m.content.map((b) =>
            b.type === 'image'
              ? { type: 'image_url', image_url: { url: `data:${b.mimeType};base64,${b.data}` } }
              : { type: 'text', text: b.type === 'text' ? b.text : '' },
          ),
        })
      }
    } else if (m.role === 'assistant') {
      const text = m.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('')
      const toolCalls = m.content
        .filter((b) => b.type === 'toolCall')
        .map((b) => {
          const t = b as { id: string; name: string; input: unknown }
          return { id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.input ?? {}) } }
        })
      const msg: Record<string, unknown> = { role: 'assistant', content: text || null }
      if (toolCalls.length) msg.tool_calls = toolCalls
      out.push(msg)
    } else {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content })
    }
  }
  return out
}

export async function* openaiProvider(
  context: Context,
  model: Model,
  opts: CallOptions,
): AsyncGenerator<StreamEvent> {
  const base = opts.baseUrl?.replace(/\/$/, '') || DEFAULT_BASE
  const body: Record<string, unknown> = {
    model: model.id,
    messages: toOpenAIMessages(context),
    stream: true,
    stream_options: { include_usage: true },
  }
  if (opts.maxTokens) body.max_tokens = opts.maxTokens
  if (opts.temperature != null) body.temperature = opts.temperature
  if (context.tools?.length) {
    body.tools = context.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }))
  }

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    signal: opts.signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${opts.apiKey ?? ''}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    yield { type: 'error', error: `OpenAI ${res.status}: ${text.slice(0, 300)}` }
    return
  }

  yield { type: 'start' }

  // index -> accumulating tool call
  const calls: Record<number, { id: string; name: string; args: string; started: boolean }> = {}
  let textStarted = false
  let finish: StopReason = 'end'

  for await (const data of sseEvents(res)) {
    if (data === '[DONE]') break
    let chunk: any
    try {
      chunk = JSON.parse(data)
    } catch {
      continue
    }
    if (chunk.usage) {
      yield {
        type: 'usage',
        usage: { input: chunk.usage.prompt_tokens ?? 0, output: chunk.usage.completion_tokens ?? 0 },
      }
    }
    const choice = chunk.choices?.[0]
    if (!choice) continue
    const delta = choice.delta || {}
    if (delta.content) {
      if (!textStarted) {
        textStarted = true
        yield { type: 'text_start' }
      }
      yield { type: 'text_delta', delta: delta.content }
    }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0
        const cur = (calls[idx] ||= { id: '', name: '', args: '', started: false })
        if (tc.id) cur.id = tc.id
        if (tc.function?.name) cur.name = tc.function.name
        if (cur.id && cur.name && !cur.started) {
          cur.started = true
          yield { type: 'toolcall_start', id: cur.id, name: cur.name }
        }
        if (tc.function?.arguments) {
          cur.args += tc.function.arguments
          if (cur.started) yield { type: 'toolcall_delta', id: cur.id, argsTextDelta: tc.function.arguments }
        }
      }
    }
    if (choice.finish_reason) {
      finish = mapFinish(choice.finish_reason)
      if (textStarted) yield { type: 'text_end' }
      for (const idx of Object.keys(calls)) {
        const c = calls[Number(idx)]
        let input: unknown = {}
        try {
          input = c.args ? JSON.parse(c.args) : {}
        } catch {
          input = {}
        }
        yield { type: 'toolcall_end', toolCall: { id: c.id, name: c.name, input } }
      }
    }
  }
  yield { type: 'done', reason: finish }
}
