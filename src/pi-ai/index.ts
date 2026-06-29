// pi-ai — a tiny provider-agnostic LLM layer (Anthropic + OpenAI).
// Mirrors the surface of @earendil-works/pi-ai: stream(model, context, opts)
// yields a normalized StreamEvent vocabulary; complete() collects a final message.
import { anthropicProvider } from './adapters/anthropic'
import { openaiProvider } from './adapters/openai'
import type {
  AssistantMessage,
  CallOptions,
  Context,
  ContentBlock,
  Message,
  Model,
  Provider,
  StreamEvent,
} from './types'

export * from './types'
export { getModel, getModels, resolveModel, MODELS } from './models'

function providerFor(api: Model['api']): Provider {
  switch (api) {
    case 'anthropic':
      return anthropicProvider
    case 'openai':
      return openaiProvider
  }
}

export function stream(model: Model, context: Context, opts: CallOptions = {}): AsyncGenerator<StreamEvent> {
  return providerFor(model.api)(context, model, opts)
}

/**
 * Keep only the newest `keep` images in an outbound conversation; older ones become a
 * short text placeholder. Screenshots (markup, self-check) and uploads would otherwise
 * be re-sent on every turn forever, inflating tokens. Pure — input messages untouched,
 * so the stored history / UI keep their images.
 */
export function trimImages(messages: Message[], keep = 2): Message[] {
  let total = 0
  for (const m of messages) {
    if (m.role !== 'toolResult' && typeof m.content !== 'string') {
      for (const b of m.content) if (b.type === 'image') total++
    }
  }
  let toDrop = total - keep
  if (toDrop <= 0) return messages

  return messages.map((m) => {
    if (toDrop <= 0 || m.role === 'toolResult' || typeof m.content === 'string') return m
    let changed = false
    const content = m.content.map((b): ContentBlock => {
      if (b.type === 'image' && toDrop > 0) {
        toDrop--
        changed = true
        return { type: 'text', text: '[历史图片已省略：为节省上下文，此处的旧附件/截图未重发]' }
      }
      return b
    })
    return changed ? { ...m, content } : m
  })
}

/** Collect a stream into a single assistant message (text + tool calls). */
export async function complete(model: Model, context: Context, opts: CallOptions = {}): Promise<AssistantMessage> {
  const content: ContentBlock[] = []
  let text = ''
  const msg: AssistantMessage = { role: 'assistant', content, stopReason: 'end' }
  for await (const ev of stream(model, context, opts)) {
    switch (ev.type) {
      case 'text_delta':
        text += ev.delta
        break
      case 'text_end':
        if (text) content.push({ type: 'text', text })
        text = ''
        break
      case 'toolcall_end':
        content.push({ type: 'toolCall', id: ev.toolCall.id, name: ev.toolCall.name, input: ev.toolCall.input })
        break
      case 'usage':
        msg.usage = ev.usage
        break
      case 'done':
        msg.stopReason = ev.reason
        break
      case 'error':
        msg.stopReason = 'error'
        content.push({ type: 'text', text: `⚠︎ ${ev.error}` })
        break
    }
  }
  if (text) content.push({ type: 'text', text })
  return msg
}
