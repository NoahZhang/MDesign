// Renderer-side client for the main-process agent (Electron). Mirrors the
// in-browser runAgent callback surface, but the loop runs in Node main and
// streams events back over IPC. verify() executes here (needs the DOM).
import { verifyDesign } from '../agent/verify'
import type { Message } from '../pi-ai'
import type { AgentStatus } from '../agent/agent'
import { setMessages, setProjectFiles } from './store'
import { uid } from './id'
import type { CliAgentConfig, ModelConfig, Project, ProjectFile, Settings } from './types'

export interface GenDsResult {
  name: string
  colors: { name: string; value: string }[]
  headingFont: string
  bodyFont: string
  radius: number
  spec: string
}

interface ElectronAgentApi {
  run: (payload: unknown) => Promise<{ ok: boolean; error?: string }>
  runCli: (payload: unknown) => Promise<{ ok: boolean; error?: string }>
  stop: (runId?: string) => void
  onEvent: (cb: (ev: { runId?: string; type: string; data: any }) => void) => () => void
  sendVerifyResult: (id: string, result: { problems: string[]; screenshot?: string }) => void
  generateDesignSystem?: (payload: unknown) => Promise<{ ok: boolean; error?: string; ds?: GenDsResult }>
}

function api(): ElectronAgentApi | null {
  const w = window as unknown as { mdesign?: { isElectron?: boolean; agent?: ElectronAgentApi } }
  return w.mdesign?.isElectron && w.mdesign.agent ? w.mdesign.agent : null
}

export const isElectron = (): boolean => !!api()

export interface RunCallbacks {
  onMessages: (m: Message[]) => void
  onStatus: (s: AgentStatus | null) => void
  onToolStream: (t: { id: string; name: string; argsText: string } | null) => void
  onSelectFile: (p: string) => void
}

export async function runAgentViaIpc(args: {
  project: Project
  settings: Settings
  systemPrompt: string
  baseMessages: Message[]
  wantVerify: boolean
  cbs: RunCallbacks
  signal: AbortSignal
}): Promise<void> {
  const a = api()
  if (!a) throw new Error('not electron')
  let last: Message[] = args.baseMessages
  const runId = uid('run')

  return new Promise<void>((resolve) => {
    const onAbort = () => a.stop(runId)
    args.signal.addEventListener('abort', onAbort)

    const off = a.onEvent((ev) => {
      if (ev.runId !== runId) return // ignore other concurrent runs' events (no cross-contamination)
      switch (ev.type) {
        case 'messages':
          last = ev.data as Message[]
          args.cbs.onMessages(last)
          setMessages(args.project.id, last)
          break
        case 'files':
          setProjectFiles(args.project.id, ev.data as ProjectFile[])
          break
        case 'status':
          args.cbs.onStatus(ev.data as AgentStatus | null)
          break
        case 'toolStream':
          args.cbs.onToolStream(ev.data)
          break
        case 'selectFile':
          args.cbs.onSelectFile(ev.data as string)
          break
        case 'verify-request': {
          const { id, path, files } = ev.data as { id: string; path: string; files: ProjectFile[] }
          verifyDesign(path, files)
            .then((res) => a.sendVerifyResult(id, res))
            .catch(() => a.sendVerifyResult(id, { problems: [] }))
          break
        }
        case 'error': {
          const next: Message[] = [...last, { role: 'assistant', content: [{ type: 'text', text: `⚠︎ ${ev.data}` }], stopReason: 'error' }]
          last = next
          args.cbs.onMessages(next)
          setMessages(args.project.id, next)
          break
        }
        case 'end':
          off()
          args.signal.removeEventListener('abort', onAbort)
          resolve()
          break
      }
    })

    a.run({
      runId,
      project: args.project,
      settings: args.settings,
      systemPrompt: args.systemPrompt,
      baseMessages: args.baseMessages,
      wantVerify: args.wantVerify,
    })
  })
}

// CLI mode: drive a coding CLI (codex/opencode) in main. Same streamed events
// (messages/files/status) so the chat + preview reuse the API-path handling.
export async function runCliViaIpc(args: {
  projectId: string
  cfg: CliAgentConfig
  prompt: string
  brief: string
  designSystem: string
  baseMessages: Message[]
  files: ProjectFile[]
  cbs: RunCallbacks
  signal: AbortSignal
}): Promise<void> {
  const a = api()
  if (!a) throw new Error('not electron')
  let last: Message[] = args.baseMessages
  const runId = uid('run')

  return new Promise<void>((resolve) => {
    const onAbort = () => a.stop(runId)
    args.signal.addEventListener('abort', onAbort)
    const off = a.onEvent((ev) => {
      if (ev.runId !== runId) return // ignore other concurrent runs' events
      switch (ev.type) {
        case 'messages':
          last = ev.data as Message[]
          args.cbs.onMessages(last)
          setMessages(args.projectId, last)
          break
        case 'files':
          setProjectFiles(args.projectId, ev.data as ProjectFile[])
          break
        case 'status':
          args.cbs.onStatus(ev.data as AgentStatus | null)
          break
        case 'toolStream':
          args.cbs.onToolStream(ev.data)
          break
        case 'error': {
          const next: Message[] = [...last, { role: 'assistant', content: [{ type: 'text', text: `⚠︎ ${ev.data}` }], stopReason: 'error' }]
          last = next
          args.cbs.onMessages(next)
          setMessages(args.projectId, next)
          break
        }
        case 'end':
          off()
          args.signal.removeEventListener('abort', onAbort)
          resolve()
          break
      }
    })
    a.runCli({ runId, projectId: args.projectId, cfg: args.cfg, prompt: args.prompt, brief: args.brief, designSystem: args.designSystem, baseMessages: args.baseMessages, files: args.files })
  })
}

/**
 * Generate a design system from a URL and/or a text brief (Electron main does the
 * crawl + generation). Routes through the active agent: CLI mode (opencode/codex) or
 * the API model.
 */
export async function generateDesignSystemViaIpc(args: {
  mode: 'api' | 'cli'
  model?: ModelConfig
  cfg?: CliAgentConfig
  url?: string
  text: string
}): Promise<GenDsResult> {
  const a = api()
  if (!a?.generateDesignSystem) throw new Error('设计系统自动生成仅在桌面版可用')
  const res = await a.generateDesignSystem(args)
  if (!res.ok || !res.ds) throw new Error(res.error || '生成失败')
  return res.ds
}
