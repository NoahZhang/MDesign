import { useRef, useState, type DragEvent as ReactDragEvent, type ReactNode } from 'react'
import { ChevronRight, Folder, Loader2, MoreHorizontal, RefreshCw, Upload } from 'lucide-react'
import { relTime } from '../../lib/format'
import { deleteFiles, renameFile } from '../../lib/store'
import { confirmDialog, promptDialog } from '../../lib/dialog'
import { ingestDrop } from '../../lib/ingestFiles'
import { fileKind } from '../../lib/types'
import type { Project, ProjectFile } from '../../lib/types'

function DocIcon({ kind }: { kind: 'page' | 'component' | 'doc' }) {
  const fill = kind === 'page' ? '#F6DED3' : kind === 'component' ? '#DCE3EE' : '#EDEAE0'
  const stroke = kind === 'page' ? '#E3B49C' : kind === 'component' ? '#A9BBD6' : '#D2CCBC'
  return (
    <svg width="22" height="26" viewBox="0 0 22 26" fill="none" aria-hidden>
      <path d="M2 3.2C2 1.9 3 1 4.2 1H13l7 7v14.8c0 1.3-1 2.2-2.2 2.2H4.2C3 25 2 24.1 2 22.8V3.2Z" fill={fill} stroke={stroke} strokeWidth="1.2" />
      <path d="M13 1v6.5c0 .4.3.7.7.7H20" stroke={stroke} strokeWidth="1.2" fill="none" />
    </svg>
  )
}

const SECTION = 'px-4 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint'

function Row({
  icon,
  title,
  subtitle,
  meta,
  selected,
  onClick,
  onDoubleClick,
  onRename,
  onDelete,
  trailing,
}: {
  icon: ReactNode
  title: string
  subtitle: string
  meta?: string
  selected?: boolean
  onClick?: () => void
  onDoubleClick?: () => void
  onRename?: () => void
  onDelete?: () => void
  trailing?: ReactNode
}) {
  const [menu, setMenu] = useState(false)
  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={
        'group flex cursor-pointer items-center gap-3 border-b border-line/60 px-4 py-2.5 transition-colors ' +
        (selected ? 'bg-sink' : 'hover:bg-panel')
      }
    >
      <div className="shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium text-ink">{title}</div>
        <div className="text-[12px] text-ink-muted">{subtitle}</div>
      </div>
      {trailing}
      {meta && <div className="shrink-0 text-[12px] text-ink-faint">{meta}</div>}
      {(onRename || onDelete) && (
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setMenu((v) => !v)
            }}
            className={
              'grid h-7 w-7 place-items-center rounded-md text-ink-muted hover:bg-sink ' +
              (selected || menu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')
            }
          >
            <MoreHorizontal size={16} />
          </button>
          {menu && (
            <>
              <div className="fixed inset-0 z-20" onClick={(e) => { e.stopPropagation(); setMenu(false) }} />
              <div className="absolute right-0 top-full z-30 mt-1 w-40 rounded-xl border border-line bg-white p-1 shadow-pop">
                {onRename && (
                  <button
                    className="block w-full rounded-lg px-3 py-2 text-left text-[13px] text-ink-soft hover:bg-panel"
                    onClick={(e) => { e.stopPropagation(); setMenu(false); onRename() }}
                  >
                    Rename
                  </button>
                )}
                {onDelete && (
                  <button
                    className="block w-full rounded-lg px-3 py-2 text-left text-[13px] text-coral-dark hover:bg-coral-tint"
                    onClick={(e) => { e.stopPropagation(); setMenu(false); onDelete() }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function FilePanel({
  project,
  selected,
  onSelect,
  onOpenFile,
}: {
  project: Project
  selected: string | null
  onSelect: (path: string | null) => void
  onOpenFile: (path: string) => void
}) {
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({})
  const [spin, setSpin] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [importing, setImporting] = useState(false)
  const dragDepth = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const onDrop = async (e: ReactDragEvent) => {
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    if (!e.dataTransfer) return
    setImporting(true)
    try {
      const added = await ingestDrop(project.id, e.dataTransfer)
      if (added[0]) onSelect(added[0])
    } finally {
      setImporting(false)
    }
  }

  const onPick = async (files: FileList | null) => {
    if (!files?.length) return
    setImporting(true)
    try {
      const dt = new DataTransfer()
      for (const f of Array.from(files)) dt.items.add(f)
      const added = await ingestDrop(project.id, dt)
      if (added[0]) onSelect(added[0])
    } finally {
      setImporting(false)
    }
  }

  const visible = project.files.filter((f) => !f.path.endsWith('/.keep'))
  const top = visible.filter((f) => !f.path.includes('/'))
  const folderNames = Array.from(
    new Set(project.files.filter((f) => f.path.includes('/')).map((f) => f.path.split('/')[0])),
  )
  const byTime = (a: ProjectFile, b: ProjectFile) => b.updatedAt - a.updatedAt
  const pages = top.filter((f) => fileKind(f.path) === 'page').sort(byTime)
  const components = top.filter((f) => fileKind(f.path) === 'component').sort(byTime)
  const others = top.filter((f) => !['page', 'component'].includes(fileKind(f.path))).sort(byTime)


  const rename = async (f: ProjectFile) => {
    const to = await promptDialog('重命名文件', f.path)
    if (to && to !== f.path) {
      renameFile(project.id, f.path, to)
      if (selected === f.path) onSelect(to)
    }
  }
  const del = async (f: ProjectFile) => {
    if (await confirmDialog(`删除文件「${f.path}」？`)) {
      deleteFiles(project.id, [f.path])
      if (selected === f.path) onSelect(null)
    }
  }

  const fileRow = (f: ProjectFile, kind: 'page' | 'component' | 'doc', sub: string) => (
    <Row
      key={f.path}
      icon={<DocIcon kind={kind} />}
      title={f.path}
      subtitle={sub}
      meta={relTime(f.updatedAt)}
      selected={selected === f.path}
      onClick={() => onSelect(f.path)}
      onDoubleClick={() => onOpenFile(f.path)}
      onRename={() => rename(f)}
      onDelete={() => del(f)}
    />
  )

  return (
    <div
      className="relative flex h-full flex-col bg-white"
      onDragEnter={(e) => {
        if (!e.dataTransfer?.types.includes('Files')) return
        e.preventDefault()
        dragDepth.current++
        setDragging(true)
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer?.types.includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={onDrop}
    >
      {(dragging || importing) && (
        <div className="pointer-events-none absolute inset-2 z-40 grid place-items-center rounded-xl border-2 border-dashed border-coral bg-coral-tint/70 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-[14px] font-medium text-coral-dark">
            {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {importing ? '正在导入…' : '松开即可加入项目'}
          </div>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          onPick(e.target.files)
          e.target.value = ''
        }}
      />
      {/* toolbar */}
      <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <button className="grid h-7 w-7 place-items-center rounded-md text-ink-muted hover:bg-panel" title="Up">
          <ChevronRight size={16} className="-rotate-90" />
        </button>
        <button
          onClick={() => {
            setSpin(true)
            setTimeout(() => setSpin(false), 500)
          }}
          className="grid h-7 w-7 place-items-center rounded-md text-ink-muted hover:bg-panel"
          title="Refresh"
        >
          <RefreshCw size={15} className={spin ? 'animate-spin' : ''} />
        </button>
        <span className="text-[13.5px] font-medium text-ink-soft">project</span>
      </div>

      {/* sections */}
      <div className="thin-scrollbar flex-1 overflow-y-auto">
        {folderNames.length > 0 && (
          <>
            <div className={SECTION}>Folders</div>
            {folderNames.map((name) => {
              const children = visible.filter((f) => f.path.startsWith(name + '/'))
              const open = openFolders[name]
              return (
                <div key={name}>
                  <Row
                    icon={<Folder size={20} className="text-ink-faint" />}
                    title={name}
                    subtitle="Folder"
                    meta="—"
                    onClick={() => setOpenFolders((s) => ({ ...s, [name]: !s[name] }))}
                    trailing={
                      <ChevronRight
                        size={15}
                        className={'text-ink-faint transition-transform ' + (open ? 'rotate-90' : '')}
                      />
                    }
                  />
                  {open &&
                    (children.length === 0 ? (
                      <div className="border-b border-line/60 py-2.5 pl-12 text-[12.5px] text-ink-faint">empty</div>
                    ) : (
                      children.map((f) => (
                        <div key={f.path} className="pl-6">
                          {fileRow(f, fileKind(f.path) === 'page' ? 'page' : fileKind(f.path) === 'component' ? 'component' : 'doc', f.path.split('/').slice(1).join('/'))}
                        </div>
                      ))
                    ))}
                </div>
              )
            })}
          </>
        )}

        {pages.length > 0 && (
          <>
            <div className={SECTION}>Pages</div>
            {pages.map((f) => fileRow(f, 'page', 'HTML page'))}
          </>
        )}

        {components.length > 0 && (
          <>
            <div className={SECTION}>Components</div>
            {components.map((f) => fileRow(f, 'component', 'Component'))}
          </>
        )}

        {others.length > 0 && (
          <>
            <div className={SECTION}>Files</div>
            {others.map((f) => fileRow(f, 'doc', f.contentType))}
          </>
        )}

        {visible.length === 0 && (
          <div className="px-4 py-10 text-center text-[13px] text-ink-muted">
            No files yet. Describe something in chat and I’ll create the files here.
          </div>
        )}
      </div>

      {/* drop footer (also clickable to pick files) */}
      <button
        onClick={() => inputRef.current?.click()}
        className="flex w-full items-center gap-2 border-t border-line px-4 py-3 text-left text-[12.5px] text-ink-muted transition-colors hover:bg-panel"
        title="点击选择文件，或把文件/文件夹拖到这里"
      >
        <Upload size={14} className="text-ink-faint" />
        <span className="font-semibold uppercase tracking-wide text-ink-faint">Drop files here</span>
        <span className="truncate">— Images, docs, or folders.</span>
      </button>
    </div>
  )
}
