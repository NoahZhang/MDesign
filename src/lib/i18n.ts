// Lightweight built-in i18n (no dependency). Components call `const t = useT()` then
// `t('area.key')`; non-component code uses `tGet(...)`. English is the fallback.
import { getState, useSettings } from './store'
import { DICT } from './i18n.dict'

export type Lang = 'en' | 'zh'

export const LANGS: { code: Lang; label: string }[] = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
]

/** Language used until the user picks one — defaults to English. */
export const DEFAULT_LANG: Lang = 'en'

type Vars = Record<string, string | number>

function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`))
}

function translate(lang: Lang, key: string, vars?: Vars): string {
  const s = DICT[lang]?.[key] ?? DICT.en[key] ?? key
  return interpolate(s, vars)
}

const currentLang = (): Lang => getState().settings.lang ?? DEFAULT_LANG

/** Reactive translator for components — re-renders when the language changes. */
export function useT(): (key: string, vars?: Vars) => string {
  const lang = useSettings().lang ?? DEFAULT_LANG
  return (key, vars) => translate(lang, key, vars)
}

/** Non-reactive translator for lib / non-component code. */
export function tGet(key: string, vars?: Vars): string {
  return translate(currentLang(), key, vars)
}
