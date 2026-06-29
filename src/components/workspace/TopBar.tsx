import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronDown, ChevronLeft, Code2, FileText, FolderArchive, Globe, ListChecks, Loader2, Maximize2, MessageSquare, MonitorPlay, PanelsTopLeft, Play, X } from 'lucide-react'
import { PaletteMark } from '../Logo'
import { deleteProject, renameProject, setProjectDesignSystem, useDesignSystems, useStore } from '../../lib/store'
import { resolveHtml } from '../../lib/resolveHtml'
import { isDeckHtml } from '../../lib/deckHtml'
import { usePreviewNav } from '../../lib/usePreviewNav'
import { exportStandalone, exportZip } from '../../lib/exportProject'
import { exportHtmlToPptx } from '../../lib/htmlToPptx'
import { alertDialog, confirmDialog, promptDialog } from '../../lib/dialog'
import DeckView from './DeckView'
import type { Project } from '../../lib/types'

export const FILES_TAB = '__files__'
export const QUESTIONS_TAB = '__questions__'

export type TabKind = 'files' | 'questions' | 'file'
export interface TabItem {
  id: string
  label: string
  kind: TabKind
}
export interface TabsProps {
  items: TabItem[]
  active: string
  onActivate: (id: string) => void
  onClose: (id: string) => void
}

function tabIcon(kind: TabKind): ReactNode {
  if (kind === 'files') return <PanelsTopLeft size={14} />
  if (kind === 'questions') return <ListChecks size={14} />
  return <FileText size={14} />
}

function PItem({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] text-ink-soft hover:bg-panel"
    >
      <span className="text-ink-muted">{icon}</span>
      {label}
    </button>
  )
}

function TabChip({
  active,
  label,
  icon,
  onClick,
  onClose,
}: {
  active: boolean
  label: string
  icon: ReactNode
  onClick: () => void
  onClose?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={
        'group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg py-1.5 pl-2.5 text-[13px] transition-colors ' +
        (onClose ? 'pr-1.5 ' : 'pr-2.5 ') +
        (active ? 'bg-sink font-medium text-ink' : 'text-ink-muted hover:bg-panel hover:text-ink')
      }
    >
      <span className="shrink-0 text-ink-muted">{icon}</span>
      <span className="max-w-[150px] truncate">{label}</span>
      {onClose && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          className={
            'grid h-4 w-4 shrink-0 place-items-center rounded text-ink-faint hover:bg-line hover:text-ink ' +
            (active ? 'opacity-70' : 'opacity-0 group-hover:opacity-100')
          }
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}

export default function TopBar({
  project,
  chatWidth,
  tabs,
}: {
  project: Project
  chatWidth: number
  tabs: TabsProps
}) {
  const navigate = useNavigate()
  const user = useStore((s) => s.user)
  const dss = useDesignSystems()
  const [menu, setMenu] = useState(false)
  const [presentMenu, setPresentMenu] = useState(false)
  const [shareMenu, setShareMenu] = useState(false)
  const [pptxBusy, setPptxBusy] = useState(false)
  const [overlayMode, setOverlayMode] = useState<'inTab' | 'fullscreen' | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const activeFile = project.files.find((f) => f.path === tabs.active)
  const isFileTab = tabs.items.find((i) => i.id === tabs.active)?.kind === 'file'

  // Present overlay: navigate between prototype pages in-place (links no longer
  // blow the whole app to a bogus route).
  const presentNav = usePreviewNav(project, activeFile?.path ?? '')
  const presentFile = project.files.find((f) => f.path === presentNav.path) ?? activeFile
  const presentIsHtml = !!presentFile && /\.html?$/i.test(presentFile.path)
  const overlaySrc = presentFile
    ? presentIsHtml
      ? resolveHtml(presentFile.content, project.files)
      : presentFile.content
    : ''

  const presentNewTab = () => {
    if (!activeFile) return
    const isHtml = /\.html?$/i.test(activeFile.path)
    const src = isHtml ? resolveHtml(activeFile.content, project.files) : activeFile.content
    const blob = new Blob([src], { type: isHtml ? 'text/html' : activeFile.contentType })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 8000)
  }

  // Export the currently-open HTML page's slides to a native, editable PowerPoint.
  const exportPptx = async () => {
    const target =
      activeFile && /\.html?$/i.test(activeFile.path)
        ? activeFile
        : project.files.find((f) => /\.html?$/i.test(f.path))
    if (!target) {
      alertDialog('没有可导出的 HTML 页面。')
      return
    }
    const base = target.path.split('/').pop()!.replace(/\.html?$/i, '') || project.name
    setPptxBusy(true)
    try {
      await exportHtmlToPptx(target.content, base, project.files)
      setShareMenu(false)
    } catch (e) {
      alertDialog('导出 PPTX 失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setPptxBusy(false)
    }
  }

  const openOverlay = (full: boolean) => {
    setPresentMenu(false)
    setOverlayMode(full ? 'fullscreen' : 'inTab')
  }
  const closeOverlay = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    setOverlayMode(null)
  }

  useEffect(() => {
    if (overlayMode === 'fullscreen' && overlayRef.current && !document.fullscreenElement) {
      overlayRef.current.requestFullscreen?.().catch(() => {})
    }
  }, [overlayMode])

  useEffect(() => {
    if (!overlayMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
        setOverlayMode(null)
      }
    }
    const onFs = () => {
      if (!document.fullscreenElement && overlayMode === 'fullscreen') setOverlayMode(null)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('fullscreenchange', onFs)
    }
  }, [overlayMode])

  return (
    <>
    <header className="flex h-14 shrink-0 items-stretch border-b border-line bg-panel">
      {/* left segment over the chat column */}
      <div
        className="flex items-center gap-2.5 border-r border-line px-4"
        style={{ width: chatWidth }}
      >
        <button onClick={() => navigate('/')} className="shrink-0" title="All projects">
          <PaletteMark size={26} />
        </button>
        <div className="relative">
          <button
            onClick={() => setMenu((v) => !v)}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[15px] font-semibold text-ink hover:bg-sink"
          >
            {project.name}
            <ChevronDown size={15} className="text-ink-faint" />
          </button>
          {menu && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setMenu(false)} />
              <div className="absolute left-0 top-full z-30 mt-1 w-52 rounded-xl border border-line bg-white p-1 shadow-pop">
                <button
                  className="block w-full rounded-lg px-3 py-2 text-left text-[13.5px] text-ink-soft hover:bg-panel"
                  onClick={async () => {
                    setMenu(false)
                    const name = await promptDialog('重命名项目', project.name)
                    if (name) renameProject(project.id, name)
                  }}
                >
                  Rename project
                </button>
                <button
                  className="block w-full rounded-lg px-3 py-2 text-left text-[13.5px] text-ink-soft hover:bg-panel"
                  onClick={() => {
                    setMenu(false)
                    navigate('/')
                  }}
                >
                  Back to all projects
                </button>
                {dss.systems.length > 0 && (
                  <>
                    <div className="my-1 h-px bg-line" />
                    <div className="px-3 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                      设计系统
                    </div>
                    {(
                      [
                        {
                          key: 'default',
                          label: `跟随默认${
                            dss.systems.find((s) => s.id === dss.defaultId)?.name
                              ? `（${dss.systems.find((s) => s.id === dss.defaultId)!.name}）`
                              : '（无）'
                          }`,
                          checked: project.designSystemId === undefined,
                          pick: undefined as string | null | undefined,
                        },
                        { key: 'none', label: '不使用', checked: project.designSystemId === null, pick: null },
                        ...dss.systems.map((s) => ({
                          key: s.id,
                          label: s.name || '未命名',
                          checked: project.designSystemId === s.id,
                          pick: s.id as string | null | undefined,
                        })),
                      ] as { key: string; label: string; checked: boolean; pick: string | null | undefined }[]
                    ).map((opt) => (
                      <button
                        key={opt.key}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] text-ink-soft hover:bg-panel"
                        onClick={() => {
                          setProjectDesignSystem(project.id, opt.pick)
                          setMenu(false)
                        }}
                      >
                        <span className="grid w-4 shrink-0 place-items-center">
                          {opt.checked && <Check size={13} className="text-coral-dark" />}
                        </span>
                        <span className="truncate">{opt.label}</span>
                      </button>
                    ))}
                  </>
                )}
                <div className="my-1 h-px bg-line" />
                <button
                  className="block w-full rounded-lg px-3 py-2 text-left text-[13.5px] text-coral-dark hover:bg-coral-tint"
                  onClick={async () => {
                    setMenu(false)
                    if (await confirmDialog(`删除「${project.name}」？此操作不可撤销。`)) {
                      deleteProject(project.id)
                      navigate('/')
                    }
                  }}
                >
                  Delete project
                </button>
              </div>
            </>
          )}
        </div>
        <button className="ml-auto grid h-8 w-8 place-items-center rounded-md text-ink-muted hover:bg-sink" title="Chat">
          <MessageSquare size={17} />
        </button>
      </div>

      {/* right segment: tab bar over the files pane */}
      <div className="flex flex-1 items-center gap-3 px-3">
        <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.items.map((it) => (
            <TabChip
              key={it.id}
              active={tabs.active === it.id}
              label={it.label}
              icon={tabIcon(it.kind)}
              onClick={() => tabs.onActivate(it.id)}
              onClose={it.kind === 'files' ? undefined : () => tabs.onClose(it.id)}
            />
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          {isFileTab && (
            <div className="relative">
              <button
                onClick={() => setPresentMenu((v) => !v)}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[13.5px] text-ink-soft hover:bg-sink"
              >
                Present
                <ChevronDown size={13} className="text-ink-faint" />
              </button>
              {presentMenu && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setPresentMenu(false)} />
                  <div className="absolute right-0 top-full z-30 mt-1 w-44 rounded-xl border border-line bg-white p-1 shadow-pop">
                    <PItem icon={<Maximize2 size={15} />} label="In this tab" onClick={() => openOverlay(false)} />
                    <PItem icon={<Play size={15} />} label="Fullscreen" onClick={() => openOverlay(true)} />
                    <PItem
                      icon={<Globe size={15} />}
                      label="New tab"
                      onClick={() => {
                        setPresentMenu(false)
                        presentNewTab()
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          )}
          <div className="relative">
            <button
              onClick={() => setShareMenu((v) => !v)}
              className="rounded-lg bg-ink px-3.5 py-1.5 text-[13.5px] font-medium text-white hover:bg-ink-soft"
            >
              Share
            </button>
            {shareMenu && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setShareMenu(false)} />
                <div className="absolute right-0 top-full z-30 mt-1 w-60 rounded-xl border border-line bg-white p-1 shadow-pop">
                  <button
                    onClick={() => {
                      setShareMenu(false)
                      exportZip(project)
                    }}
                    className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-panel"
                  >
                    <FolderArchive size={16} className="mt-0.5 shrink-0 text-ink-muted" />
                    <span>
                      <span className="block text-[13.5px] font-medium text-ink">
                        Project archive <span className="font-normal text-ink-muted">.zip</span>
                      </span>
                      <span className="block text-[12px] text-ink-muted">项目所有文件打包下载</span>
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      setShareMenu(false)
                      exportStandalone(project)
                    }}
                    className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-panel"
                  >
                    <Code2 size={16} className="mt-0.5 shrink-0 text-ink-muted" />
                    <span>
                      <span className="block text-[13.5px] font-medium text-ink">Standalone HTML</span>
                      <span className="block text-[12px] text-ink-muted">内联成单个自包含 HTML</span>
                    </span>
                  </button>
                  <button
                    onClick={exportPptx}
                    disabled={pptxBusy}
                    className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-panel disabled:opacity-60"
                  >
                    {pptxBusy ? (
                      <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-coral-dark" />
                    ) : (
                      <MonitorPlay size={16} className="mt-0.5 shrink-0 text-ink-muted" />
                    )}
                    <span>
                      <span className="block text-[13.5px] font-medium text-ink">
                        PowerPoint <span className="font-normal text-ink-muted">.pptx</span>
                      </span>
                      <span className="block text-[12px] text-ink-muted">
                        {pptxBusy ? '正在导出…' : '把当前页面的幻灯片导出为可编辑 PPT'}
                      </span>
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
          <div className="grid h-8 w-8 place-items-center rounded-full bg-coral text-[13px] font-semibold text-white">
            {user.initial}
          </div>
        </div>
      </div>
    </header>

      {overlayMode && activeFile && (
        <div ref={overlayRef} className="fixed inset-0 z-[60] bg-paper">
          {isDeckHtml(activeFile.content) ? (
            <DeckView project={project} path={activeFile.path} />
          ) : (
            <iframe
              ref={presentNav.iframeRef}
              title="present"
              key={presentNav.path}
              srcDoc={overlaySrc}
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              className="h-full w-full border-0 bg-white"
            />
          )}
          {!isDeckHtml(activeFile.content) && presentNav.back && (
            <button
              onClick={presentNav.back}
              className="absolute left-4 top-4 flex items-center gap-1 rounded-lg border border-line bg-white/90 px-3 py-1.5 text-[13px] font-medium text-ink shadow-pop backdrop-blur hover:bg-white"
              title="返回"
            >
              <ChevronLeft size={15} /> 返回
            </button>
          )}
          <button
            onClick={closeOverlay}
            className="absolute right-4 top-4 flex items-center gap-1.5 rounded-lg border border-line bg-white/90 px-3 py-1.5 text-[13px] font-medium text-ink shadow-pop backdrop-blur hover:bg-white"
            title="退出 (Esc)"
          >
            <X size={15} /> 退出
          </button>
        </div>
      )}
    </>
  )
}
