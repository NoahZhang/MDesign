import { useState } from 'react'
import { Plus, Search, Star } from 'lucide-react'
import Sidebar from '../components/gallery/Sidebar'
import ProjectCard from '../components/gallery/ProjectCard'
import TutorialCard from '../components/gallery/TutorialCard'
import DesignSystemModal from '../components/gallery/DesignSystemModal'
import LangSwitcher from '../components/LangSwitcher'
import { useDesignSystems, useSaveError, useStore } from '../lib/store'
import { useT } from '../lib/i18n'

const TABS = ['Recent', 'Your designs', 'Examples', 'Design systems'] as const
type Tab = (typeof TABS)[number]

export default function Gallery() {
  const t = useT()
  const projects = useStore((s) => s.projects)
  const tutorialDismissed = useStore((s) => s.tutorialDismissed)
  const { systems, defaultId } = useDesignSystems()
  const saveError = useSaveError()
  const [tab, setTab] = useState<Tab>('Recent')
  const [query, setQuery] = useState('')
  const [showDS, setShowDS] = useState(false)

  const TAB_LABELS: Record<Tab, string> = {
    Recent: t('gallery.tab_recent'),
    'Your designs': t('gallery.tab_your_designs'),
    Examples: t('gallery.tab_examples'),
    'Design systems': t('gallery.tab_design_systems'),
  }

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
            ⚠︎ {t('gallery.save_error')}
          </div>
        )}
        {/* header row */}
        <div className="flex items-center justify-between gap-6">
          <nav className="flex items-end gap-7">
            {TABS.map((tabId) => {
              const active = tab === tabId
              return (
                <button
                  key={tabId}
                  onClick={() => setTab(tabId)}
                  className={
                    'relative pb-2 text-[15px] transition-colors ' +
                    (active ? 'font-medium text-ink' : 'text-ink-muted hover:text-ink')
                  }
                >
                  {TAB_LABELS[tabId]}
                  {active && <span className="absolute -bottom-px left-0 h-0.5 w-full rounded-full bg-ink" />}
                </button>
              )
            })}
          </nav>

          <div className="flex items-center gap-2">
            <div className="relative w-[300px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('gallery.search_placeholder')}
                className="w-full rounded-lg border border-line bg-white py-2.5 pl-9 pr-3 text-[14px] text-ink placeholder:text-ink-faint focus:border-coral-muted focus:outline-none"
              />
            </div>
            <LangSwitcher />
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
                  {t('gallery.no_match', { query })}
                </div>
              )}
            </div>
          ) : tab === 'Examples' ? (
            <div className="py-24 text-center text-[14px] text-ink-muted">{t('gallery.examples_empty')}</div>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {systems.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setShowDS(true)}
                  className="rounded-2xl border border-line bg-white p-5 text-left shadow-card transition-shadow hover:shadow-raised"
                >
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-[15px] font-semibold text-ink">{s.name || t('ds.untitled')}</h3>
                    {defaultId === s.id && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-coral-tint px-2 py-0.5 text-[11px] font-medium text-coral-dark">
                        <Star size={11} fill="currentColor" /> {t('ds.default')}
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
                    {s.headingFont || s.bodyFont ? `${s.headingFont || s.bodyFont} · ` : ''}{t('ds.radius_short', { n: s.radius })}
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
                  <Plus size={16} /> {t('ds.new')}
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
