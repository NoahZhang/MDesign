// Bridge between the app's Message DTO (src/pi-ai/types — used by the store/UI)
// and pi-ai's Message shape (used by the agent loop in main).
import type {
  ContentBlock as AppBlock,
  Message as AppMessage,
} from '../pi-ai/types'
import type {
  AssistantMessage as PiAssistant,
  Message as PiMessage,
  TextContent,
  ImageContent,
  ToolCall,
} from '@earendil-works/pi-ai'

const PLACEHOLDER_ASSISTANT = {
  api: 'anthropic-messages',
  provider: 'anthropic',
  model: '',
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: 'stop' as const,
  timestamp: 0,
}

export function toPi(m: AppMessage): PiMessage {
  if (m.role === 'toolResult') {
    return {
      role: 'toolResult',
      toolCallId: m.toolCallId,
      toolName: m.toolName,
      content: [{ type: 'text', text: m.content }],
      isError: !!m.isError,
      timestamp: 0,
    }
  }
  if (m.role === 'user') {
    const content =
      typeof m.content === 'string'
        ? m.content
        : (m.content.map(appBlockToUser).filter((b) => b !== null) as (TextContent | ImageContent)[])
    return { role: 'user', content, timestamp: 0 }
  }
  // assistant
  const content = m.content.map(appBlockToAssistant).filter(Boolean) as (TextContent | ToolCall)[]
  return { role: 'assistant', content, ...PLACEHOLDER_ASSISTANT } as PiAssistant
}

function appBlockToUser(b: AppBlock): TextContent | ImageContent | null {
  if (b.type === 'text') return { type: 'text', text: b.text }
  if (b.type === 'image') return { type: 'image', data: b.data, mimeType: b.mimeType }
  return null
}

function appBlockToAssistant(b: AppBlock): TextContent | ToolCall | null {
  if (b.type === 'text') return { type: 'text', text: b.text }
  if (b.type === 'toolCall')
    return { type: 'toolCall', id: b.id, name: b.name, arguments: (b.input ?? {}) as Record<string, any> }
  return null
}

export function toApp(m: PiMessage): AppMessage {
  if (m.role === 'toolResult') {
    const text = m.content
      .map((c) => (c.type === 'text' ? c.text : '[image]'))
      .join('')
    return { role: 'toolResult', toolCallId: m.toolCallId, toolName: m.toolName, content: text, isError: m.isError }
  }
  if (m.role === 'user') {
    if (typeof m.content === 'string') return { role: 'user', content: m.content }
    const blocks: AppBlock[] = m.content.map((c) =>
      c.type === 'image' ? { type: 'image', data: c.data, mimeType: c.mimeType } : { type: 'text', text: c.text },
    )
    return { role: 'user', content: blocks }
  }
  // assistant
  const blocks: AppBlock[] = []
  for (const c of m.content) {
    if (c.type === 'text') blocks.push({ type: 'text', text: c.text })
    else if (c.type === 'toolCall') blocks.push({ type: 'toolCall', id: c.id, name: c.name, input: c.arguments })
    // thinking blocks are dropped from the app DTO (UI doesn't render them)
  }
  const SR = { stop: 'end', length: 'max_tokens', toolUse: 'tool_use', error: 'error', aborted: 'error' } as const
  return { role: 'assistant', content: blocks, stopReason: SR[m.stopReason], usage: { input: m.usage.input, output: m.usage.output } }
}

export const toPiAll = (ms: AppMessage[]): PiMessage[] => ms.map(toPi)
export const toAppAll = (ms: PiMessage[]): AppMessage[] => ms.map(toApp)
