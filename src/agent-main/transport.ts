// Main-process transport: turn an app model-config into a pi-ai Model + streamFn.
// Runs in Node (Electron main) — direct HTTPS to the provider, no proxy/CORS.
import { streamSimple } from '@earendil-works/pi-ai/compat'
import type { Model, SimpleStreamOptions } from '@earendil-works/pi-ai'

export interface AppModel {
  id: string
  name: string
  api: 'anthropic' | 'openai'
  model?: string
  apiKey?: string
  baseUrl?: string
  /** Max output tokens per request; defaults to a widely-compatible cap. */
  maxTokens?: number
}

// A default that virtually every chat model accepts (over-requesting 400s on models
// with a lower output cap, e.g. Claude 3.5 Sonnet = 8192). Per-model config can raise it.
const DEFAULT_MAX_TOKENS = 8192

// Reverse the browser's proxy prefixes back to absolute hosts (Node has no CORS).
// The OpenAI SDK appends only "/chat/completions", so its base must end in "/v1"; the
// Anthropic SDK appends "/v1/messages", so its base is just the host.
function absoluteBaseUrl(api: 'anthropic' | 'openai', baseUrl?: string): string {
  const b = (baseUrl ?? '').trim().replace(/\/$/, '')
  const map: Record<string, string> = {
    '/llm/ark': 'https://ark.cn-beijing.volces.com',
    '/llm/anthropic': 'https://api.anthropic.com',
    '/llm/openai': 'https://api.openai.com/v1',
  }
  for (const [prefix, host] of Object.entries(map)) {
    if (b === prefix || b.startsWith(prefix + '/')) return host + b.slice(prefix.length)
  }
  if (/^https?:\/\//i.test(b)) return b
  return api === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'
}

export interface Transport {
  model: Model<'anthropic-messages' | 'openai-completions'>
  options: SimpleStreamOptions
  streamFn: typeof streamSimple
}

export function buildTransport(m: AppModel): Transport {
  const api = m.api === 'openai' ? 'openai-completions' : 'anthropic-messages'
  const maxTokens = m.maxTokens && m.maxTokens > 0 ? m.maxTokens : DEFAULT_MAX_TOKENS
  const model = {
    id: m.model || m.id,
    name: m.name,
    api,
    provider: m.api === 'openai' ? 'openai' : 'anthropic',
    baseUrl: absoluteBaseUrl(m.api, m.baseUrl),
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 256000,
    maxTokens,
    // Anthropic-style prompt caching on the gateway; it's an Anthropic-protocol endpoint.
    compat: m.api === 'anthropic' ? { cacheControlFormat: 'anthropic' as const } : undefined,
  } as Model<'anthropic-messages' | 'openai-completions'>

  const options: SimpleStreamOptions = { apiKey: m.apiKey, maxTokens, cacheRetention: 'short' }
  return { model, options, streamFn: streamSimple }
}
