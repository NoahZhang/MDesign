import type { Message } from '../pi-ai'

export type ProjectCategory = 'Prototype' | 'Slide deck' | 'Template' | 'Other'
export type ProjectRole = 'Owner' | 'Editor' | 'Viewer'
export type FileKind = 'page' | 'component' | 'asset' | 'doc'

export interface ProjectFile {
  path: string
  content: string
  contentType: string
  updatedAt: number
}

export interface Project {
  id: string
  name: string
  category: ProjectCategory
  role: ProjectRole
  createdAt: number
  updatedAt: number
  files: ProjectFile[]
  /** Full pi-ai conversation (text, tool calls, tool results). */
  messages: Message[]
  /** Design system pick: undefined = follow the default, null = none, or a system id. */
  designSystemId?: string | null
}

/** A saved model configuration the user can switch between. */
export interface ModelConfig {
  id: string
  name: string
  api: 'anthropic' | 'openai'
  /** The provider's model id sent in the request. */
  model: string
  /** Optional base URL override (e.g. an OpenAI-compatible gateway / Ark). */
  baseUrl: string
  apiKey: string
  /** Max output tokens per request (optional; transport uses a safe default if unset). */
  maxTokens?: number
  /** Context window in tokens (optional; drives compaction timing — e.g. 1000000 for Kimi K3). */
  contextWindow?: number
  /** Thinking level sent as `reasoning_effort` (none = omit the param entirely). */
  reasoningEffort?: 'high' | 'xhigh' | 'max'
}

/** A local coding-CLI agent (codex / opencode), run as a child process (CLI mode). */
export interface CliAgentConfig {
  id: string
  /** Optional label; display derives from model + thinking level (see cliLabel). */
  name?: string
  kind: 'codex' | 'opencode' | 'claude'
  /** Executable name or absolute path (defaults to the kind name). */
  command?: string
  /** Proxy for the CLI's network access, e.g. http://127.0.0.1:6152. */
  proxy?: string
  /** Optional provider base-URL / key overrides injected into the CLI env. */
  baseUrl?: string
  apiKey?: string
  /** Model id (codex: e.g. gpt-5-codex / o3; opencode: provider/model). */
  model?: string
  /** Reasoning/thinking effort (codex: model_reasoning_effort; opencode: --variant). */
  reasoning?: string
}

export interface Settings {
  /** Saved model configs the user manages. */
  models: ModelConfig[]
  /** Which config is currently in use. */
  activeId: string
  /** Which system prompt to inject: condensed, or the full Claude Design prompt. */
  promptMode: 'condensed' | 'full'
  /** Post-generation self-check: render the deliverable and have the agent fix findings. */
  verify: boolean
  /** API mode (our pi-agent-core loop) vs CLI mode (spawn a coding CLI). */
  agentMode?: 'api' | 'cli'
  /** Configured CLI agents (CLI mode). */
  cliAgents?: CliAgentConfig[]
  /** Which CLI agent is active (CLI mode). */
  activeCliId?: string
  /** UI language (undefined = auto-detect from the OS). */
  lang?: 'en' | 'zh'
}

/** The currently-active model config (falls back to the first, or undefined if none). */
export function activeModel(s: Settings): ModelConfig | undefined {
  return s.models.find((m) => m.id === s.activeId) ?? s.models[0]
}

/** The currently-active CLI agent (CLI mode). */
export function activeCli(s: Settings): CliAgentConfig | undefined {
  const list = s.cliAgents ?? []
  return list.find((c) => c.id === s.activeCliId) ?? list[0]
}

/** Display label for a CLI agent: model name + thinking level (kind shown separately). */
export function cliLabel(c: CliAgentConfig): string {
  const m = c.model && c.model.trim() ? c.model.trim() : '默认模型'
  return c.reasoning ? `${m} · ${c.reasoning}` : m
}

/** Display label for an API model: name + thinking level when one is set (e.g. "k3 · max"). */
export function modelLabel(m: ModelConfig): string {
  return m.reasoningEffort ? `${m.name} · ${m.reasoningEffort}` : m.name
}

export interface AppUser {
  name: string
  org: string
  initial: string
}

/** A named color token in a design system. */
export interface DSColor {
  name: string
  value: string
}

/** A reusable brand/design system the agent applies to what it generates. */
export interface DesignSystem {
  id: string
  name: string
  /** Token-level fields — compiled into a :root block + font <link> and used for the picker preview. */
  colors: DSColor[]
  headingFont: string
  bodyFont: string
  radius: number
  /**
   * The rich, agent-readable design spec (a "DESIGN.md"): atmosphere, type scale,
   * component styling, layout/spacing, elevation, do's & don'ts, voice. This is the
   * heart of the system — the tokens above are just the machine-readable summary.
   */
  spec: string
}

/** All saved design systems + which one new/unpinned projects use ('' = none). */
export interface DesignSystemsState {
  systems: DesignSystem[]
  defaultId: string
}

/** The design system a project actually uses: explicit pick > default > none. */
export function resolveDesignSystem(dss: DesignSystemsState, project: Project): DesignSystem | null {
  if (project.designSystemId === null) return null
  const id = project.designSystemId ?? dss.defaultId
  return dss.systems.find((s) => s.id === id) ?? null
}

export interface AppState {
  projects: Project[]
  settings: Settings
  tutorialDismissed: boolean
  user: AppUser
  designSystems: DesignSystemsState
}

export function fileKind(path: string): FileKind {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'html' || ext === 'htm') return 'page'
  if (['jsx', 'tsx', 'js', 'ts', 'vue', 'svelte'].includes(ext)) return 'component'
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return 'asset'
  return 'doc'
}

export function contentTypeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    html: 'text/html',
    htm: 'text/html',
    jsx: 'text/jsx',
    tsx: 'text/tsx',
    js: 'text/javascript',
    ts: 'text/typescript',
    css: 'text/css',
    json: 'application/json',
    md: 'text/markdown',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
  }
  return map[ext] ?? 'text/plain'
}
