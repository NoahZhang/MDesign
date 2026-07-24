// Unified, provider-agnostic LLM types.
// Modeled on @earendil-works/pi-ai (https://github.com/earendil-works/pi):
// a single Context { systemPrompt, messages, tools } streams through any provider,
// normalized into one StreamEvent vocabulary.

export type JSONSchema = Record<string, unknown>

export interface Tool {
  name: string
  description: string
  /** JSON Schema object describing the tool input. */
  parameters: JSONSchema
}

export type TextBlock = { type: 'text'; text: string }
export type ImageBlock = { type: 'image'; data: string; mimeType: string }
export type ToolCallBlock = { type: 'toolCall'; id: string; name: string; input: unknown }
export type ContentBlock = TextBlock | ImageBlock | ToolCallBlock

export type UserMessage = { role: 'user'; content: string | ContentBlock[] }
export type AssistantMessage = {
  role: 'assistant'
  content: ContentBlock[]
  stopReason?: StopReason
  usage?: Usage
}
export type ToolResultMessage = {
  role: 'toolResult'
  toolCallId: string
  toolName: string
  content: string
  isError?: boolean
}
export type Message = UserMessage | AssistantMessage | ToolResultMessage

export type StopReason = 'end' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'error'
export type Usage = { input: number; output: number }

export interface Context {
  systemPrompt?: string
  messages: Message[]
  tools?: Tool[]
}

export type Api = 'anthropic' | 'openai'

export interface Model {
  id: string
  name: string
  api: Api
  provider: string
  contextWindow?: number
}

export type StreamEvent =
  | { type: 'start' }
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'thinking_end' }
  | { type: 'text_start' }
  | { type: 'text_delta'; delta: string }
  | { type: 'text_end' }
  | { type: 'toolcall_start'; id: string; name: string }
  | { type: 'toolcall_delta'; id: string; argsTextDelta: string }
  | { type: 'toolcall_end'; toolCall: { id: string; name: string; input: unknown } }
  | { type: 'usage'; usage: Usage }
  | { type: 'done'; reason: StopReason }
  | { type: 'error'; error: string }

export interface CallOptions {
  apiKey?: string
  /** Base URL override. Defaults to the dev proxy path for the provider. */
  baseUrl?: string
  maxTokens?: number
  temperature?: number
  /** Thinking level sent as `reasoning_effort` (omit = provider default). */
  reasoningEffort?: 'high' | 'xhigh' | 'max'
  signal?: AbortSignal
}

export type Provider = (context: Context, model: Model, opts: CallOptions) => AsyncGenerator<StreamEvent>
