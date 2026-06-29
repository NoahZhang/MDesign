import { useSyncExternalStore } from 'react'
import type { Message } from '../pi-ai'
import { uid } from './id'
import { defaultSettings, migrateDesignSystems, migrateSettings, seedState } from './seed'
import { contentTypeFor } from './types'
import type { AppState, AppUser, DesignSystem, DesignSystemsState, Project, ProjectCategory, ProjectFile, Settings } from './types'

const DEFAULT_USER: AppUser = { name: 'Noah', org: 'Noah zhang', initial: 'N' }

// In-memory mirror of the server DB. `state` is a placeholder until bootstrap().
let state: AppState = {
  projects: [],
  settings: defaultSettings(),
  tutorialDismissed: false,
  user: DEFAULT_USER,
  designSystems: { systems: [], defaultId: '' },
}
let ready = false
let saveError = false
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((l) => l())
}
function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

// ---- server sync (per-project, debounced) ----
const dirtyProjects = new Set<string>()
const deletedProjects = new Set<string>()
let dirtyMeta = false
let flushTimer: ReturnType<typeof setTimeout> | null = null

async function api(method: string, url: string, body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}`)
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(flush, 500)
}

async function flush() {
  if (!ready) return
  const ids = [...dirtyProjects]
  const dels = [...deletedProjects]
  const meta = dirtyMeta
  dirtyProjects.clear()
  deletedProjects.clear()
  dirtyMeta = false
  try {
    for (const id of dels) await api('DELETE', `/api/projects/${encodeURIComponent(id)}`)
    for (const id of ids) {
      const p = state.projects.find((x) => x.id === id)
      if (p) await api('PUT', `/api/projects/${encodeURIComponent(id)}`, p)
    }
    if (meta) {
      await api('PUT', '/api/meta', {
        settings: state.settings,
        user: state.user,
        tutorialDismissed: state.tutorialDismissed,
        designSystem: state.designSystems,
      })
    }
    if (saveError) {
      saveError = false
      notify()
    }
  } catch (e) {
    // re-queue so the next flush retries
    ids.forEach((i) => dirtyProjects.add(i))
    dels.forEach((i) => deletedProjects.add(i))
    if (meta) dirtyMeta = true
    if (!saveError) {
      saveError = true
      notify()
    }
    console.error('[claude-design] save to server failed:', e)
    scheduleFlush()
  }
}

// ---- bootstrap ----
function fromRaw(raw: {
  projects?: Project[]
  settings?: Partial<Settings> | null
  user?: AppUser | null
  tutorialDismissed?: boolean
  designSystem?: unknown
}): AppState {
  return {
    projects: raw.projects ?? [],
    settings: migrateSettings(raw.settings),
    user: raw.user ?? DEFAULT_USER,
    tutorialDismissed: !!raw.tutorialDismissed,
    designSystems: migrateDesignSystems(raw.designSystem),
  }
}

/** One-time read of any prior localStorage data to migrate it into the server. */
function recoverFromLocalStorage(): AppState | null {
  for (const key of ['claude-design:v3', 'claude-design:v2', 'claude-design:v1']) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      if (parsed?.projects?.length) return fromRaw(parsed)
    } catch {
      /* ignore */
    }
  }
  return null
}

async function bootstrap() {
  let next: AppState | null = null
  try {
    const res = await fetch('/api/state')
    if (res.ok) {
      const data = await res.json()
      if ((data.projects?.length ?? 0) > 0 || data.settings != null) next = fromRaw(data)
    }
  } catch {
    /* server unreachable — fall through to local recovery/seed */
  }

  if (next) {
    state = next
    ready = true
    notify()
    return
  }

  // server empty: recover prior localStorage data if any, else seed, then save up
  state = recoverFromLocalStorage() ?? seedState()
  ready = true
  notify()
  state.projects.forEach((p) => dirtyProjects.add(p.id))
  dirtyMeta = true
  flush()
}

bootstrap()

// ---- core ----
export function getState(): AppState {
  return state
}

function set(next: AppState) {
  state = next
  notify()
  scheduleFlush()
}

export function update(fn: (s: AppState) => AppState) {
  const next = fn(state)
  next.projects.forEach((p) => dirtyProjects.add(p.id))
  dirtyMeta = true
  set(next)
}

export function updateProject(id: string, fn: (p: Project) => Project) {
  dirtyProjects.add(id)
  set({ ...state, projects: state.projects.map((p) => (p.id === id ? fn(p) : p)) })
}

// ---- project ops ----
export function createProject(name: string, category: ProjectCategory = 'Other'): Project {
  const now = Date.now()
  const project: Project = {
    id: uid('p'),
    name: name.trim() || 'Untitled',
    category,
    role: 'Owner',
    createdAt: now,
    updatedAt: now,
    files: [],
    messages: [],
  }
  dirtyProjects.add(project.id)
  set({ ...state, projects: [project, ...state.projects] })
  return project
}

export function deleteProject(id: string) {
  dirtyProjects.delete(id)
  deletedProjects.add(id)
  set({ ...state, projects: state.projects.filter((p) => p.id !== id) })
  // Electron: also remove the project's persistent CLI working dir + session.
  const w = window as unknown as { mdesign?: { agent?: { cliCleanup?: (id: string) => void } } }
  w.mdesign?.agent?.cliCleanup?.(id)
}

export function renameProject(id: string, name: string) {
  updateProject(id, (p) => ({ ...p, name: name.trim() || p.name, updatedAt: Date.now() }))
}

export function getProject(id: string): Project | undefined {
  return state.projects.find((p) => p.id === id)
}

// ---- file ops (path-based virtual FS) ----
export function writeFile(projectId: string, path: string, content: string): boolean {
  let created = false
  updateProject(projectId, (p) => {
    const now = Date.now()
    const idx = p.files.findIndex((f) => f.path === path)
    const next = [...p.files]
    if (idx >= 0) {
      next[idx] = { ...next[idx], content, updatedAt: now }
    } else {
      created = true
      next.push({ path, content, contentType: contentTypeFor(path), updatedAt: now })
    }
    return { ...p, files: next, updatedAt: now }
  })
  return created
}

export function replaceInFile(projectId: string, path: string, oldStr: string, newStr: string): boolean {
  let ok = false
  updateProject(projectId, (p) => {
    const idx = p.files.findIndex((f) => f.path === path)
    if (idx < 0 || !p.files[idx].content.includes(oldStr)) return p
    ok = true
    const next = [...p.files]
    next[idx] = { ...next[idx], content: next[idx].content.replace(oldStr, newStr), updatedAt: Date.now() }
    return { ...p, files: next, updatedAt: Date.now() }
  })
  return ok
}

export function deleteFiles(projectId: string, paths: string[]) {
  updateProject(projectId, (p) => ({
    ...p,
    files: p.files.filter((f) => !paths.some((d) => f.path === d || f.path.startsWith(d.replace(/\/?$/, '/')))),
    updatedAt: Date.now(),
  }))
}

export function renameFile(projectId: string, from: string, to: string) {
  updateProject(projectId, (p) => ({
    ...p,
    files: p.files.map((f) => (f.path === from ? { ...f, path: to, updatedAt: Date.now() } : f)),
    updatedAt: Date.now(),
  }))
}

// Replace a project's whole file set (used to apply the main-process agent's
// in-memory snapshot streamed over IPC).
export function setProjectFiles(projectId: string, files: ProjectFile[]) {
  updateProject(projectId, (p) => ({ ...p, files, updatedAt: Date.now() }))
}

// ---- chat ops ----
export function setMessages(projectId: string, messages: Message[]) {
  updateProject(projectId, (p) => ({ ...p, messages, updatedAt: Date.now() }))
}

export function clearMessages(projectId: string) {
  updateProject(projectId, (p) => ({ ...p, messages: [] }))
}

// ---- settings / misc ----
export function updateSettings(patch: Partial<Settings>) {
  dirtyMeta = true
  set({ ...state, settings: { ...state.settings, ...patch } })
}

// ---- design systems ----
function setDss(next: DesignSystemsState) {
  dirtyMeta = true
  set({ ...state, designSystems: next })
}

/** Add a new system or replace the one with the same id. */
export function upsertDesignSystem(ds: DesignSystem) {
  const { systems, defaultId } = state.designSystems
  const exists = systems.some((s) => s.id === ds.id)
  setDss({
    systems: exists ? systems.map((s) => (s.id === ds.id ? ds : s)) : [...systems, ds],
    // first system created becomes the default automatically
    defaultId: exists || systems.length > 0 ? defaultId : ds.id,
  })
}

export function deleteDesignSystem(id: string) {
  const { systems, defaultId } = state.designSystems
  setDss({ systems: systems.filter((s) => s.id !== id), defaultId: defaultId === id ? '' : defaultId })
}

/** '' clears the default (projects without an explicit pick get none). */
export function setDefaultDesignSystem(id: string) {
  setDss({ ...state.designSystems, defaultId: id })
}

/** Pin a project's design system: undefined = follow default, null = none, or a system id. */
export function setProjectDesignSystem(projectId: string, pick: string | null | undefined) {
  updateProject(projectId, (p) => ({ ...p, designSystemId: pick, updatedAt: Date.now() }))
}

export function dismissTutorial() {
  dirtyMeta = true
  set({ ...state, tutorialDismissed: true })
}

export function resetAll() {
  state.projects.forEach((p) => deletedProjects.add(p.id))
  dirtyProjects.clear()
  dirtyMeta = true
  set(seedState())
}

// ---- React hooks ----
export function useReady(): boolean {
  return useSyncExternalStore(subscribe, () => ready, () => ready)
}

export function useSaveError(): boolean {
  return useSyncExternalStore(subscribe, () => saveError, () => saveError)
}

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  )
}

export function useProjects(): Project[] {
  return useStore((s) => s.projects)
}

export function useProject(id: string | undefined): Project | undefined {
  return useStore((s) => (id ? s.projects.find((p) => p.id === id) : undefined))
}

export function useSettings(): Settings {
  return useStore((s) => s.settings)
}

export function useDesignSystems(): DesignSystemsState {
  return useStore((s) => s.designSystems)
}
