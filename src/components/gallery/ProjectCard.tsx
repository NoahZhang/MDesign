import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MoreHorizontal } from 'lucide-react'
import { galleryDate } from '../../lib/format'
import { deleteProject, renameProject } from '../../lib/store'
import { confirmDialog, promptDialog } from '../../lib/dialog'
import type { Project } from '../../lib/types'

function FolderGlyph() {
  return (
    <svg width="62" height="50" viewBox="0 0 62 50" fill="none" aria-hidden>
      <path
        d="M3 8.5C3 6 5 4 7.5 4h14.2c1.5 0 2.9.7 3.8 1.9l2.3 3.1H54.5C57 8 59 10 59 12.5V42c0 2.5-2 4.5-4.5 4.5h-47C5 46.5 3 44.5 3 42V8.5Z"
        fill="#FCFBF8"
        stroke="#D9D5C8"
        strokeWidth="1.4"
      />
      <path d="M3 15.5h56" stroke="#E6E3D9" strokeWidth="1.2" />
    </svg>
  )
}

export default function ProjectCard({ project, tint = 0 }: { project: Project; tint?: number }) {
  const navigate = useNavigate()
  const [menu, setMenu] = useState(false)
  const tints = ['#E9E5DA', '#ECE8DE', '#E7E2D5']
  const bg = tints[tint % tints.length]

  const open = () => navigate(`/p/${project.id}`)

  return (
    <div className="group relative cursor-pointer text-left" onClick={open}>
      <div
        className="relative flex h-[150px] items-center justify-center rounded-xl2 border border-line/70 transition-shadow group-hover:shadow-raised"
        style={{ background: bg }}
      >
        <FolderGlyph />

        <button
          onClick={(e) => {
            e.stopPropagation()
            setMenu((v) => !v)
          }}
          className={
            'absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md bg-white/70 text-ink-muted backdrop-blur transition-opacity hover:bg-white hover:text-ink ' +
            (menu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')
          }
          aria-label="Project menu"
        >
          <MoreHorizontal size={16} />
        </button>

        {menu && (
          <>
            <div
              className="fixed inset-0 z-20"
              onClick={(e) => {
                e.stopPropagation()
                setMenu(false)
              }}
            />
            <div
              className="absolute right-2 top-11 z-30 w-40 rounded-xl border border-line bg-white p-1 shadow-pop"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="block w-full rounded-lg px-3 py-2 text-left text-[13px] text-ink-soft hover:bg-panel"
                onClick={async () => {
                  setMenu(false)
                  const n = await promptDialog('重命名项目', project.name)
                  if (n) renameProject(project.id, n)
                }}
              >
                Rename
              </button>
              <button
                className="block w-full rounded-lg px-3 py-2 text-left text-[13px] text-coral-dark hover:bg-coral-tint"
                onClick={async () => {
                  setMenu(false)
                  if (await confirmDialog(`删除「${project.name}」？此操作不可撤销。`)) {
                    deleteProject(project.id)
                  }
                }}
              >
                Delete
              </button>
            </div>
          </>
        )}
      </div>

      <div className="mt-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-ink">{project.name}</div>
          <div className="mt-0.5 text-[12.5px] text-ink-muted">
            Your design <span className="text-ink-faint">·</span> {galleryDate(project.updatedAt)}
          </div>
        </div>
        <span className="mt-0.5 shrink-0 rounded-md bg-sink px-2 py-1 text-[11.5px] font-medium text-ink-muted">
          {project.role}
        </span>
      </div>
    </div>
  )
}
