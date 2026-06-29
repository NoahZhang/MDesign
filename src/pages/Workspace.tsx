import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useProject } from '../lib/store'
import { useAgentRunner } from '../lib/useAgentRunner'
import type { Project } from '../lib/types'
import TopBar, { FILES_TAB, QUESTIONS_TAB, type TabItem } from '../components/workspace/TopBar'
import ChatPanel from '../components/workspace/ChatPanel'
import FilePanel from '../components/workspace/FilePanel'
import FilePreview from '../components/workspace/FilePreview'
import FileTabView from '../components/workspace/FileTabView'
import QuestionsTab from '../components/workspace/QuestionsTab'
import { LivePreview, WorkingPane } from '../components/workspace/LivePreview'

function Splitter({ onResize }: { onResize: (dx: number) => void }) {
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    let last = e.clientX
    const move = (ev: PointerEvent) => {
      onResize(ev.clientX - last)
      last = ev.clientX
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div onPointerDown={down} className="group relative z-10 w-px shrink-0 cursor-col-resize bg-line">
      <div className="absolute inset-y-0 -left-1 -right-1 transition-colors group-hover:bg-coral-muted/30" />
    </div>
  )
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export default function Workspace() {
  const { projectId } = useParams()
  const project = useProject(projectId)

  if (!project) {
    return (
      <div className="grid h-screen place-items-center bg-paper">
        <div className="text-center">
          <p className="text-[15px] text-ink">This project doesn’t exist.</p>
          <Link to="/" className="mt-2 inline-block text-[14px] font-medium text-coral-dark hover:underline">
            ← Back to all projects
          </Link>
        </div>
      </div>
    )
  }
  return <WorkspaceInner project={project} />
}

function WorkspaceInner({ project }: { project: Project }) {
  const [chatWidth, setChatWidth] = useState(420)
  const [listWidth, setListWidth] = useState(460)
  const [selected, setSelected] = useState<string | null>(null)
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<string>(FILES_TAB)

  const onAgentSelectFile = useCallback((path: string) => {
    setSelected(path)
    setActiveTab(FILES_TAB)
  }, [])

  const runner = useAgentRunner(project, onAgentSelectFile)

  // When the agent asks a question, surface (and focus) the Questions tab.
  const pendingId = runner.pendingAsk?.id
  useEffect(() => {
    if (pendingId) setActiveTab(QUESTIONS_TAB)
  }, [pendingId])

  const openFileTab = (path: string) => {
    setOpenTabs((t) => (t.includes(path) ? t : [...t, path]))
    setActiveTab(path)
  }
  const onCloseTab = (id: string) => {
    if (id === QUESTIONS_TAB) {
      setActiveTab(FILES_TAB)
      return
    }
    setOpenTabs((t) => t.filter((p) => p !== id))
    setActiveTab((a) => (a === id ? FILES_TAB : a))
  }

  // Build the tab strip: Design Files, (Questions while pending), then file tabs.
  const fileTabs = openTabs.filter((p) => project.files.some((f) => f.path === p))
  const items: TabItem[] = [
    { id: FILES_TAB, label: 'Design Files', kind: 'files' },
    ...(runner.pendingAsk ? [{ id: QUESTIONS_TAB, label: 'Questions', kind: 'questions' as const }] : []),
    ...fileTabs.map((p) => ({ id: p, label: p.split('/').pop() || p, kind: 'file' as const })),
  ]
  const activeValid = items.some((i) => i.id === activeTab) ? activeTab : FILES_TAB

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-panel">
      <TopBar
        project={project}
        chatWidth={chatWidth}
        tabs={{ items, active: activeValid, onActivate: setActiveTab, onClose: onCloseTab }}
      />

      <div className="flex min-h-0 flex-1">
        {/* chat */}
        <div style={{ width: chatWidth }} className="min-w-0 shrink-0">
          <ChatPanel
            project={project}
            messages={runner.messages}
            running={runner.running}
            status={runner.status}
            onSend={runner.send}
            onStop={runner.stop}
          />
        </div>
        <Splitter onResize={(dx) => setChatWidth((w) => clamp(w + dx, 330, 640))} />

        {/* right region */}
        <div className="flex min-w-0 flex-1">
          {activeValid === FILES_TAB ? (
            <>
              <div style={{ width: listWidth }} className="min-w-0 shrink-0 border-r border-line">
                <FilePanel project={project} selected={selected} onSelect={setSelected} onOpenFile={openFileTab} />
              </div>
              <Splitter onResize={(dx) => setListWidth((w) => clamp(w + dx, 300, 820))} />
              <div className="min-w-0 flex-1">
                {runner.liveFile ? (
                  <LivePreview path={runner.liveFile.path} content={runner.liveFile.content} />
                ) : runner.running ? (
                  <WorkingPane status={runner.status} />
                ) : (
                  <FilePreview project={project} selected={selected} />
                )}
              </div>
            </>
          ) : activeValid === QUESTIONS_TAB && runner.pendingAsk ? (
            <div className="min-w-0 flex-1">
              <QuestionsTab
                spec={runner.pendingAsk.spec}
                running={runner.running}
                onContinue={(content) => {
                  runner.answerQuestions(content)
                  setActiveTab(FILES_TAB)
                }}
              />
            </div>
          ) : (
            <div className="min-w-0 flex-1">
              <FileTabView project={project} path={activeValid} chatWidth={chatWidth} onSendToChat={runner.send} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
