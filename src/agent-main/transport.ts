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
}

// Reverse the browser's proxy prefixes back to absolute hosts (Node has no CORS).
function absoluteBaseUrl(api: 'anthropic' | 'openai', baseUrl?: string): string {
  const b = (baseUrl ?? '').trim().replace(/\/$/, '')
  const map: Record<string, string> = {
    '/llm/ark': 'https://ark.cn-beijing.volces.com',
    '/llm/anthropic': 'https://api.anthropic.com',
    '/llm/openai': 'https://api.openai.com',
  }
  for (const [prefix, host] of Object.entries(map)) {
    if (b === prefix || b.startsWith(prefix + '/')) return host + b.slice(prefix.length)
  }
  if (/^https?:\/\//i.test(b)) return b
  return api === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com'
}

export interface Transport {
  model: Model<'anthropic-messages' | 'openai-completions'>
  options: SimpleStreamOptions
  streamFn: typeof streamSimple
}

export function buildTransport(m: AppModel): Transport {
  const api = m.api === 'openai' ? 'openai-completions' : 'anthropic-messages'
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
    maxTokens: 32768,
    // Anthropic-style prompt caching on the gateway; it's an Anthropic-protocol endpoint.
    compat: m.api === 'anthropic' ? { cacheControlFormat: 'anthropic' as const } : undefined,
  } as Model<'anthropic-messages' | 'openai-completions'>

  const options: SimpleStreamOptions = { apiKey: m.apiKey, maxTokens: 32768, cacheRetention: 'short' }
  return { model, options, streamFn: streamSimple }
}
