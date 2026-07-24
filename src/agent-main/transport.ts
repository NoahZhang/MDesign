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
  /** Context window in tokens; drives compaction timing. Defaults to 256k. */
  contextWindow?: number
  /** Thinking level sent as `reasoning_effort` in the request body (unset = omit). */
  reasoningEffort?: 'high' | 'xhigh' | 'max'
}

// pi-ai has no extra-body hook, so `reasoning_effort` rides in via a marker header:
// buildTransport sets it on the request headers, and a one-time fetch wrapper moves it
// into the JSON body (and strips the header) before the request leaves the process.
const EFFORT_HEADER = 'x-mdesign-reasoning-effort'
let effortPatchInstalled = false
function ensureEffortFetchPatch() {
  if (effortPatchInstalled) return
  effortPatchInstalled = true
  const orig = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
      const effort = headers.get(EFFORT_HEADER)
      if (effort && init?.body && typeof init.body === 'string') {
        headers.delete(EFFORT_HEADER)
        const body = JSON.parse(init.body) as Record<string, unknown>
        body.reasoning_effort = effort
        return orig(input, { ...init, headers, body: JSON.stringify(body) })
      }
    } catch {
      /* malformed/non-JSON body — send unmodified */
    }
    return orig(input, init)
  }) as typeof fetch
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

export interface RetryInfo {
  attempt: number
  delayMs: number
  error: string
}

// Transient provider failures worth retrying: rate limits (kimi 429 "engine overloaded",
// anthropic 529), 5xx, and network blips. Decide by HTTP status when one is present
// (pi-ai prefixes it) — keyword matching alone misfires (e.g. kimi's 401 body says
// "please try again", which must NOT be retried). Keywords only cover no-status
// network errors.
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 529])
const NETWORK_ERROR = /timed?.?out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|socket hang up|network/i

function isTransient(errText: string): boolean {
  const m = errText.match(/\b([1-5]\d\d)\b/)
  if (m) return RETRYABLE_STATUS.has(Number(m[1]))
  return NETWORK_ERROR.test(errText)
}

const RETRY_DELAYS_MS = [2000, 8000, 20000]

/**
 * Wrap a pi-ai stream fn with backoff retries. Only retries when the request failed
 * BEFORE any content streamed (a mid-stream cutoff must not be retried — it would
 * duplicate output) and the error looks transient. The wrapper preserves the stream
 * interface (async-iterable + .result()).
 */
function withRetry(inner: typeof streamSimple, onRetry?: (info: RetryInfo) => void): typeof streamSimple {
  type InnerStream = AsyncIterable<{ type?: string }> & { result(): Promise<unknown> }
  const wrapped = (model: unknown, context: unknown, options?: { signal?: AbortSignal }) => {
    let settled = false
    let resolveResult!: (v: unknown) => void
    let rejectResult!: (e: unknown) => void
    const resultP = new Promise((res, rej) => {
      resolveResult = res
      rejectResult = rej
    })
    resultP.catch(() => {}) // consumers may only iterate; don't let the result reject unhandled
    const settleOk = (v: unknown) => {
      if (!settled) {
        settled = true
        resolveResult(v)
      }
    }
    const settleErr = (e: unknown) => {
      if (!settled) {
        settled = true
        rejectResult(e)
      }
    }

    let current: InnerStream | null = null
    const gen = (async function* () {
      try {
        for (let attempt = 0; ; attempt++) {
          const canRetry = attempt < RETRY_DELAYS_MS.length
          const s = (inner as (m: unknown, c: unknown, o?: unknown) => InnerStream)(model, context, options)
          current = s
          let content = false
          // Hold back the terminal 'done'/'error' event: pi-agent-core awaits
          // .result() the moment it SEES that event (while our generator is still
          // suspended at the yield), so the result must be settled before we emit it.
          let held: unknown = null
          let threw: unknown = null
          try {
            for await (const ev of s) {
              const t = ev && ev.type
              if (t === 'done' || t === 'error') {
                held = ev
                continue
              }
              if (t && t !== 'start') content = true
              yield ev
            }
          } catch (e) {
            threw = e
          }
          type StreamResult = { stopReason?: string; errorMessage?: string }
          let result: StreamResult | null = null
          let resultErr: unknown = null
          if (!threw) {
            try {
              result = (await s.result()) as StreamResult
            } catch (e) {
              resultErr = e
            }
          }
          const failed = !!threw || !!resultErr || result?.stopReason === 'error'
          const errText = String(
            (threw as Error)?.message ?? (resultErr as Error)?.message ?? (result?.stopReason === 'error' ? result?.errorMessage ?? 'error' : ''),
          )
          if (failed && !content && canRetry && !options?.signal?.aborted && isTransient(errText)) {
            const delayMs = RETRY_DELAYS_MS[attempt]
            onRetry?.({ attempt: attempt + 1, delayMs, error: errText.slice(0, 160) })
            await new Promise((r) => setTimeout(r, delayMs))
            continue
          }
          if (threw || resultErr) {
            settleErr(threw ?? resultErr)
            throw threw ?? resultErr
          }
          // Settle BEFORE the final yield: a consumer may stop iterating right after an
          // error event, which finalizes this generator mid-yield — result() must
          // already be resolved by then or its awaiter deadlocks.
          settleOk(result)
          if (held) yield held as { type?: string }
          return
        }
      } finally {
        // Consumer bailed early (break/abort) — settle from the live inner stream.
        if (!settled) {
          if (current) current.result().then(settleOk, settleErr)
          else settleErr(new Error('stream terminated before completion'))
        }
      }
    })()
    ;(gen as unknown as { result: () => Promise<unknown> }).result = () => resultP
    return gen
  }
  return wrapped as unknown as typeof streamSimple
}

export function buildTransport(m: AppModel, onRetry?: (info: RetryInfo) => void): Transport {
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
    contextWindow: m.contextWindow && m.contextWindow > 0 ? m.contextWindow : 256000,
    maxTokens,
    // Anthropic-style prompt caching on the gateway; it's an Anthropic-protocol endpoint.
    compat: m.api === 'anthropic' ? { cacheControlFormat: 'anthropic' as const } : undefined,
  } as Model<'anthropic-messages' | 'openai-completions'>

  const options: SimpleStreamOptions = { apiKey: m.apiKey, maxTokens, cacheRetention: 'short' }
  if (m.reasoningEffort) {
    ensureEffortFetchPatch()
    ;(options as SimpleStreamOptions & { headers?: Record<string, string> }).headers = { [EFFORT_HEADER]: m.reasoningEffort }
  }
  return { model, options, streamFn: withRetry(streamSimple, onRetry) }
}
