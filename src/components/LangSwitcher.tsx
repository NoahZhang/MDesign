import { Languages } from 'lucide-react'
import { updateSettings, useSettings } from '../lib/store'
import { DEFAULT_LANG } from '../lib/i18n'

/** Compact EN ⇄ 中文 toggle (only two languages). Shows the current one; click switches. */
export default function LangSwitcher({ className = '' }: { className?: string }) {
  const cur = useSettings().lang ?? DEFAULT_LANG
  return (
    <button
      onClick={() => updateSettings({ lang: cur === 'zh' ? 'en' : 'zh' })}
      className={'flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-ink-soft hover:bg-panel ' + className}
      title="Language / 语言"
    >
      <Languages size={15} className="text-ink-faint" />
      {cur === 'zh' ? '中文' : 'EN'}
    </button>
  )
}
