import { useState } from 'react'
import { Plus, Search, Star } from 'lucide-react'
import Sidebar from '../components/gallery/Sidebar'
import ProjectCard from '../components/gallery/ProjectCard'
import TutorialCard from '../components/gallery/TutorialCard'
import DesignSystemModal from '../components/gallery/DesignSystemModal'
import { useDesignSystems, useSaveError, useStore } from '../lib/store'

const TABS = ['Recent', 'Your designs', 'Examples', 'Design systems'] as const
type Tab = (typeof TABS)[number]

export default function Gallery() {
  const projects = useStore((s) => s.projects)
  const tutorialDismissed = useStore((s) => s.tutorialDismissed)
  const { systems, defaultId } = useDesignSystems()
  const saveError = useSaveError()
  const [tab, setTab] = useState<Tab>('Recent')
  const [query, setQuery] = useState('')
  const [showDS, setShowDS] = useState(false)

  const q = query.trim().toLowerCase()
  const filtered = projects.filter((p) => !q || p.name.toLowerCase().includes(q))
  const showTutorial = tab !== 'Examples' && tab !== 'Design systems' && !tutorialDismissed && !q
  const showProjects = tab === 'Recent' || tab === 'Your designs'

  return (
    <div className="flex min-h-screen bg-paper">
      <Sidebar />

      <main className="min-w-0 flex-1 px-10 py-7">
        {saveError && (
          <div className="mb-4 rounded-lg border border-coral-muted bg-coral-tint px-4 py-2.5 text-[13px] text-ink">
            ⚠︎ 保存到服务器失败，请确认 dev server 正在运行（npm run dev）。
          </div>
        )}
        {/* header row */}
        <div className="flex items-center justify-between gap-6">
          <nav className="flex items-end gap-7">
            {TABS.map((t) => {
              const active = tab === t
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={
                    'relative pb-2 text-[15px] transition-colors ' +
                    (active ? 'font-medium text-ink' : 'text-ink-muted hover:text-ink')
                  }
                >
                  {t}
                  {active && <span className="absolute -bottom-px left-0 h-0.5 w-full rounded-full bg-ink" />}
                </button>
              )
            })}
          </nav>

          <div className="relative w-[300px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search designs"
              className="w-full rounded-lg border border-line bg-white py-2.5 pl-9 pr-3 text-[14px] text-ink placeholder:text-ink-faint focus:border-coral-muted focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-7 border-t border-line/60 pt-7">
          {showProjects ? (
            <div className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {showTutorial && <TutorialCard />}
              {filtered.map((p, i) => (
                <ProjectCard key={p.id} project={p} tint={i} />
              ))}
              {filtered.length === 0 && !showTutorial && (
                <div className="col-span-full py-16 text-center text-[14px] text-ink-muted">
                  No designs match “{query}”.
                </div>
              )}
            </div>
          ) : tab === 'Examples' ? (
            <div className="py-24 text-center text-[14px] text-ink-muted">Curated examples will appear here.</div>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {systems.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setShowDS(true)}
                  className="rounded-2xl border border-line bg-white p-5 text-left shadow-card transition-shadow hover:shadow-raised"
                >
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-[15px] font-semibold text-ink">{s.name || '未命名'}</h3>
                    {defaultId === s.id && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-coral-tint px-2 py-0.5 text-[11px] font-medium text-coral-dark">
                        <Star size={11} fill="currentColor" /> 默认
                      </span>
                    )}
                  </div>
                  {s.colors.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {s.colors.slice(0, 10).map((c, i) => (
                        <span key={i} className="h-6 w-6 rounded-lg border border-line" style={{ background: c.value }} title={c.name} />
                      ))}
                    </div>
                  )}
                  <div className="mt-3 text-[12px] text-ink-muted">
                    {s.headingFont || s.bodyFont ? `${s.headingFont || s.bodyFont} · ` : ''}圆角 {s.radius}px
                  </div>
                  {s.spec && (
                    <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-ink-faint">
                      {s.spec.replace(/^#+\s.*$/gm, '').replace(/[*`>#-]/g, '').replace(/\s+/g, ' ').trim()}
                    </p>
                  )}
                </button>
              ))}
              <button
                onClick={() => setShowDS(true)}
                className="grid min-h-[120px] place-items-center rounded-2xl border border-dashed border-line text-ink-muted transition-colors hover:bg-white hover:text-ink"
              >
                <span className="flex items-center gap-1.5 text-[13.5px] font-medium">
                  <Plus size={16} /> 新建设计系统
                </span>
              </button>
            </div>
          )}
        </div>
      </main>
      {showDS && <DesignSystemModal onClose={() => setShowDS(false)} />}
    </div>
  )
}
