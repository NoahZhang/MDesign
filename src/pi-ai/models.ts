import type { Model } from './types'

// A small built-in catalog. Custom OpenAI-compatible models (Ollama, vLLM,
// OpenRouter, gateways…) can be added by id in the in-app Settings.
export const MODELS: Model[] = [
  { id: 'ark-code-latest', name: 'ark-code-latest', api: 'anthropic', provider: 'Volcengine Ark', contextWindow: 256000 },
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', api: 'anthropic', provider: 'Anthropic', contextWindow: 200000 },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', api: 'anthropic', provider: 'Anthropic', contextWindow: 200000 },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', api: 'anthropic', provider: 'Anthropic', contextWindow: 200000 },
  { id: 'gpt-4o', name: 'GPT-4o', api: 'openai', provider: 'OpenAI', contextWindow: 128000 },
  { id: 'gpt-4o-mini', name: 'GPT-4o mini', api: 'openai', provider: 'OpenAI', contextWindow: 128000 },
  { id: 'o4-mini', name: 'o4-mini', api: 'openai', provider: 'OpenAI', contextWindow: 200000 },
]

export function getModels(): Model[] {
  return MODELS
}

export function getModel(id: string): Model | undefined {
  return MODELS.find((m) => m.id === id)
}

/** Resolve a model by id, falling back to a custom model under the given api. */
export function resolveModel(id: string, api: Model['api']): Model {
  return getModel(id) ?? { id, name: id, api, provider: api }
}
