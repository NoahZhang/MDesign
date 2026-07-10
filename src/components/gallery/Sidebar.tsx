import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, SlidersHorizontal } from 'lucide-react'
import { Logo } from '../Logo'
import SettingsModal from '../workspace/SettingsModal'
import DesignSystemModal from './DesignSystemModal'
import { createProject, useDesignSystems } from '../../lib/store'
import { useT } from '../../lib/i18n'
import type { ProjectCategory } from '../../lib/types'

const CATEGORIES: ProjectCategory[] = ['Prototype', 'Slide deck', 'Template', 'Other']

export default function Sidebar() {
  const t = useT()
  const navigate = useNavigate()
  const { systems, defaultId } = useDesignSystems()
  const [category, setCategory] = useState<ProjectCategory>('Prototype')
  const [showSettings, setShowSettings] = useState(false)
  const [showDS, setShowDS] = useState(false)
  const [name, setName] = useState('')

  const CATEGORY_LABELS: Record<ProjectCategory, string> = {
    Prototype: t('sidebar.cat_prototype'),
    'Slide deck': t('sidebar.cat_slide_deck'),
    Template: t('sidebar.cat_template'),
    Other: t('sidebar.cat_other'),
  }

  const defaultDs = systems.find((s) => s.id === defaultId)

  const create = () => {
    const p = createProject(name, category)
    navigate(`/p/${p.id}`)
  }

  return (
    <aside className="flex w-[372px] shrink-0 flex-col px-8 pb-6 pt-7">
      <Logo />

      {/* category chips */}
      <div className="mt-9 flex flex-nowrap gap-x-4 whitespace-nowrap text-[14.5px]">
        {CATEGORIES.map((c) => {
          const active = category === c
          return (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={
                active
                  ? 'rounded-lg bg-sink px-2.5 py-1 font-medium text-ink'
                  : 'px-0.5 py-1 text-ink-muted transition-colors hover:text-ink'
              }
            >
              {CATEGORY_LABELS[c]}
            </button>
          )
        })}
      </div>

      {/* new project */}
      <div className="mt-3 rounded-2xl border border-line bg-white p-5 shadow-card">
        <div className="text-[16px] font-semibold text-ink">{t('sidebar.new_project')}</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('sidebar.project_name_placeholder')}
          className="mt-3.5 w-full rounded-lg border border-line bg-panel px-3 py-2.5 text-[14.5px] text-ink placeholder:text-ink-faint focus:border-coral-muted focus:outline-none"
        />
        <button
          onClick={create}
          className="mt-3 w-full rounded-lg bg-coral py-2.5 text-[14.5px] font-medium text-white transition-colors hover:bg-coral-dark"
        >
          {t('common.create')}
        </button>
      </div>
      <p className="mt-3 px-1 text-[12.5px] leading-snug text-ink-faint">
        {t('sidebar.visibility_note')}
      </p>

      {/* design systems */}
      <div className="mt-6 rounded-2xl border border-line bg-white p-5 shadow-card">
        {systems.length > 0 ? (
          <>
            {defaultDs ? (
              <>
                <div className="flex items-center gap-1.5 text-[13px] font-medium text-coral-dark">
                  <Check size={15} /> {t('ds.default_system')}
                </div>
                <div className="mt-1.5 text-[14px] font-semibold text-ink">{defaultDs.name || t('ds.untitled')}</div>
                {defaultDs.colors.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {defaultDs.colors.slice(0, 8).map((c, i) => (
                      <span key={i} className="h-5 w-5 rounded-full border border-line" style={{ background: c.value }} title={c.name} />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-[13.5px] leading-relaxed text-ink-soft">
                {t('sidebar.no_default_note', { n: systems.length })}
              </p>
            )}
            <button
              onClick={() => setShowDS(true)}
              className="mt-4 w-full rounded-lg border border-line bg-white py-2.5 text-[14px] font-medium text-ink-soft transition-colors hover:bg-panel"
            >
              {t('ds.manage', { n: systems.length })}
            </button>
          </>
        ) : (
          <>
            <p className="text-[14px] leading-relaxed text-ink-soft">
              {t('ds.setup_pitch')}
            </p>
            <button
              onClick={() => setShowDS(true)}
              className="mt-4 w-full rounded-lg bg-ink py-2.5 text-[14px] font-medium text-white transition-colors hover:bg-ink-soft"
            >
              {t('ds.setup_button')}
            </button>
          </>
        )}
      </div>

      <button
        onClick={() => setShowSettings(true)}
        className="mt-3 flex w-full items-center gap-2 rounded-lg border border-line bg-white px-4 py-2.5 text-[14px] font-medium text-ink-soft transition-colors hover:bg-panel"
      >
        <SlidersHorizontal size={16} className="text-ink-muted" />
        {t('sidebar.model_settings')}
      </button>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showDS && <DesignSystemModal onClose={() => setShowDS(false)} />}
    </aside>
  )
}
