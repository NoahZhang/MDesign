import { sseEvents } from '../sse'
import type { CallOptions, Context, Message, Model, StopReason, StreamEvent } from '../types'

const DEFAULT_BASE = '/llm/anthropic'

function mapStop(reason: string | null | undefined): StopReason {
  switch (reason) {
    case 'tool_use':
      return 'tool_use'
    case 'max_tokens':
      return 'max_tokens'
    case 'stop_sequence':
      return 'stop_sequence'
    default:
      return 'end'
  }
}

/** Convert unified messages into Anthropic's message array (merging adjacent tool results). */
function toAnthropicMessages(messages: Message[]): unknown[] {
  const out: { role: 'user' | 'assistant'; content: unknown }[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      const blocks = (typeof m.content === 'string' ? [{ type: 'text' as const, text: m.content }] : m.content).map(
        (b) =>
          b.type === 'image'
            ? { type: 'image', source: { type: 'base64', media_type: b.mimeType, data: b.data } }
            : b.type === 'toolCall'
              ? { type: 'tool_use', id: b.id, name: b.name, input: b.input }
              : { type: 'text', text: b.text },
      )
      // A user message directly after tool results must join the same user turn
      // (consecutive user turns can be rejected; tool_result blocks must come first).
      const prev = out[out.length - 1]
      const prevHasToolResults =
        prev?.role === 'user' &&
        Array.isArray(prev.content) &&
        (prev.content as { type?: string }[]).some((b) => b.type === 'tool_result')
      if (prevHasToolResults) (prev.content as unknown[]).push(...blocks)
      else out.push({ role: 'user', content: typeof m.content === 'string' ? m.content : blocks })
    } else if (m.role === 'assistant') {
      const content = m.content.map((b) =>
        b.type === 'toolCall'
          ? { type: 'tool_use', id: b.id, name: b.name, input: b.input }
          : b.type === 'image'
            ? { type: 'image', source: { type: 'base64', media_type: b.mimeType, data: b.data } }
            : { type: 'text', text: b.text },
      )
      out.push({ role: 'assistant', content })
    } else {
      // toolResult -> a user turn with a tool_result block; merge into the previous
      // user turn if it already holds tool_result blocks (Anthropic wants them grouped).
      const block = {
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: m.content,
        is_error: m.isError || undefined,
      }
      const prev = out[out.length - 1]
      if (prev && prev.role === 'user' && Array.isArray(prev.content)) {
        ;(prev.content as unknown[]).push(block)
      } else {
        out.push({ role: 'user', content: [block] })
      }
    }
  }

  // Safety net: the API rejects (1) empty assistant content and (2) any tool_use
  // without a matching tool_result. Repair both so a truncated/interrupted turn
  // in the history can never 400 the next request.
  for (let i = 0; i < out.length; i++) {
    const m = out[i]
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue
    const content = m.content as Record<string, unknown>[]
    if (content.length === 0) {
      m.content = [{ type: 'text', text: '…' }]
      continue
    }
    const useIds = content.filter((b) => b.type === 'tool_use').map((b) => b.id as string)
    if (useIds.length === 0) continue
    const next = out[i + 1]
    const haveIds =
      next && next.role === 'user' && Array.isArray(next.content)
        ? (next.content as Record<string, unknown>[])
            .filter((b) => b.type === 'tool_result')
            .map((b) => b.tool_use_id as string)
        : []
    const missing = useIds.filter((id) => !haveIds.includes(id))
    if (missing.length === 0) continue
    const repair = missing.map((id) => ({ type: 'tool_result', tool_use_id: id, content: '(interrupted — no result)' }))
    if (next && next.role === 'user') {
      const existing = Array.isArray(next.content) ? next.content : [{ type: 'text', text: next.content }]
      next.content = [...repair, ...existing]
    } else {
      out.splice(i + 1, 0, { role: 'user', content: repair })
    }
  }
  return out
}

export async function* anthropicProvider(
  context: Context,
  model: Model,
  opts: CallOptions,
): AsyncGenerator<StreamEvent> {
  const base = opts.baseUrl?.replace(/\/$/, '') || DEFAULT_BASE
  // Send the system prompt as a cacheable block so a large prompt is only billed
  // in full on the first turn (prompt caching is GA — no beta header needed).
  const system = context.systemPrompt
    ? [{ type: 'text', text: context.systemPrompt, cache_control: { type: 'ephemeral' } }]
    : undefined
  const body = {
    model: model.id,
    max_tokens: opts.maxTokens ?? 32768,
    temperature: opts.temperature,
    reasoning_effort: opts.reasoningEffort,
    system,
    messages: toAnthropicMessages(context.messages),
    tools: context.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    })),
    stream: true,
  }

  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    signal: opts.signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': opts.apiKey ?? '',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    yield { type: 'error', error: `Anthropic ${res.status}: ${text.slice(0, 300)}` }
    return
  }

  yield { type: 'start' }

  // index -> {kind, id, name, json}
  const blocks: Record<number, { kind: 'text' | 'tool' | 'thinking'; id?: string; name?: string; json: string }> = {}
  let stop: StopReason = 'end'

  for await (const data of sseEvents(res)) {
    let ev: any
    try {
      ev = JSON.parse(data)
    } catch {
      continue
    }
    switch (ev.type) {
      case 'content_block_start': {
        const cb = ev.content_block
        if (cb?.type === 'tool_use') {
          blocks[ev.index] = { kind: 'tool', id: cb.id, name: cb.name, json: '' }
          yield { type: 'toolcall_start', id: cb.id, name: cb.name }
        } else if (cb?.type === 'thinking' || cb?.type === 'redacted_thinking') {
          blocks[ev.index] = { kind: 'thinking', json: '' }
          yield { type: 'thinking_start' }
        } else {
          blocks[ev.index] = { kind: 'text', json: '' }
          yield { type: 'text_start' }
        }
        break
      }
      case 'content_block_delta': {
        const b = blocks[ev.index]
        if (ev.delta?.type === 'text_delta') {
          yield { type: 'text_delta', delta: ev.delta.text }
        } else if (ev.delta?.type === 'thinking_delta') {
          yield { type: 'thinking_delta', delta: ev.delta.thinking ?? '' }
        } else if (ev.delta?.type === 'input_json_delta' && b) {
          b.json += ev.delta.partial_json ?? ''
          yield { type: 'toolcall_delta', id: b.id!, argsTextDelta: ev.delta.partial_json ?? '' }
        }
        break
      }
      case 'content_block_stop': {
        const b = blocks[ev.index]
        if (b?.kind === 'tool') {
          let input: unknown = {}
          try {
            input = b.json ? JSON.parse(b.json) : {}
          } catch {
            input = {}
          }
          yield { type: 'toolcall_end', toolCall: { id: b.id!, name: b.name!, input } }
        } else if (b?.kind === 'thinking') {
          yield { type: 'thinking_end' }
        } else {
          yield { type: 'text_end' }
        }
        break
      }
      case 'message_delta': {
        if (ev.delta?.stop_reason) stop = mapStop(ev.delta.stop_reason)
        if (ev.usage) yield { type: 'usage', usage: { input: 0, output: ev.usage.output_tokens ?? 0 } }
        break
      }
      case 'message_stop':
        yield { type: 'done', reason: stop }
        return
      case 'error':
        yield { type: 'error', error: ev.error?.message || 'stream error' }
        return
    }
  }
  yield { type: 'done', reason: stop }
}
