import { uid } from './id'
import { designPresets } from './designPresets'
import type { AppState, CliAgentConfig, DesignSystem, DesignSystemsState, ModelConfig, Settings } from './types'

/** Fresh settings: no preset models — the user adds their own. */
export function defaultSettings(): Settings {
  return { models: [], activeId: '', promptMode: 'full', verify: true, agentMode: 'api', cliAgents: [], activeCliId: '' }
}

/** Pull the CLI-agent fields off a stored settings blob (CLI mode). */
function migrateCli(s: Record<string, unknown>): Pick<Settings, 'agentMode' | 'cliAgents' | 'activeCliId'> {
  const cliAgents = Array.isArray(s.cliAgents) ? (s.cliAgents as CliAgentConfig[]) : []
  return {
    agentMode: s.agentMode === 'cli' ? 'cli' : 'api',
    cliAgents,
    activeCliId: typeof s.activeCliId === 'string' ? (s.activeCliId as string) : '',
  }
}

/** A blank design system for the editor. */
export function blankDesignSystem(): DesignSystem {
  return { id: uid('ds'), name: '', colors: [], headingFont: '', bodyFont: '', radius: 12, spec: '' }
}

function sanitizeSystem(raw: unknown): DesignSystem {
  const d = (raw ?? {}) as Partial<DesignSystem> & { notes?: string }
  return {
    id: typeof d.id === 'string' && d.id ? d.id : uid('ds'),
    name: typeof d.name === 'string' ? d.name : '',
    colors: Array.isArray(d.colors) ? d.colors.filter((c) => c && typeof c.value === 'string') : [],
    headingFont: typeof d.headingFont === 'string' ? d.headingFont : '',
    bodyFont: typeof d.bodyFont === 'string' ? d.bodyFont : '',
    radius: typeof d.radius === 'number' ? d.radius : 12,
    // Migrate the old free-text `notes` into the richer `spec`.
    spec: typeof d.spec === 'string' ? d.spec : typeof d.notes === 'string' ? d.notes : '',
  }
}

/** Accept the new {systems,defaultId} shape, or migrate the old single design system. */
export function migrateDesignSystems(raw: unknown): DesignSystemsState {
  const r = (raw ?? {}) as Record<string, unknown>
  if (Array.isArray(r.systems)) {
    const systems = r.systems.map(sanitizeSystem)
    const defaultId =
      typeof r.defaultId === 'string' && systems.some((s) => s.id === r.defaultId) ? r.defaultId : ''
    return { systems, defaultId }
  }
  // old shape: a single {enabled,name,colors,...} object
  const old = r as { enabled?: boolean; name?: string; colors?: unknown[]; notes?: string }
  const hasContent =
    !!(typeof old.name === 'string' && old.name.trim()) ||
    (Array.isArray(old.colors) && old.colors.length > 0) ||
    !!(typeof old.notes === 'string' && old.notes.trim())
  if (hasContent) {
    const sys = sanitizeSystem(raw)
    if (!sys.name) sys.name = '我的设计系统'
    return { systems: [sys], defaultId: old.enabled ? sys.id : '' }
  }
  return { systems: [], defaultId: '' }
}

/** Accept either the new shape or the old flat {api,model,apiKey,baseUrl}. */
export function migrateSettings(raw: unknown): Settings {
  const s = (raw ?? {}) as Record<string, unknown>
  if (Array.isArray(s.models)) {
    const models = s.models as ModelConfig[]
    const activeId =
      typeof s.activeId === 'string' && models.some((m) => m.id === s.activeId)
        ? (s.activeId as string)
        : (models[0]?.id ?? '')
    return {
      models,
      activeId,
      promptMode: 'full',
      verify: s.verify !== false,
      ...migrateCli(s),
    }
  }
  // migrate an old single flat config into one model entry
  if (s.model || s.api || s.apiKey || s.baseUrl) {
    const cfg: ModelConfig = {
      id: uid('m'),
      name: (s.model as string) || (s.api === 'openai' ? 'OpenAI' : 'Model'),
      api: s.api === 'openai' ? 'openai' : 'anthropic',
      model: (s.model as string) || '',
      baseUrl: (s.baseUrl as string) || '',
      apiKey: (s.apiKey as string) || '',
    }
    return {
      models: [cfg],
      activeId: cfg.id,
      promptMode: 'full',
      verify: s.verify !== false,
      ...migrateCli(s),
    }
  }
  return defaultSettings()
}

/** Fresh app state — no example projects; the user creates their own. */
export function seedState(): AppState {
  return {
    projects: [],
    settings: defaultSettings(),
    tutorialDismissed: false,
    user: { name: 'Noah', org: 'Noah zhang', initial: 'N' },
    // Ship the starter library so new installs have quality systems to pick from.
    designSystems: { systems: designPresets(), defaultId: '' },
  }
}
