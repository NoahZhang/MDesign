import { useState } from 'react'
import { Check, ImageIcon } from 'lucide-react'
import { useT } from '../../lib/i18n'
import type { Question, QuestionSpec } from '../../lib/questions'

type Answer = { selected: string[]; svg: number[]; other: string; text: string }

const blank = (): Answer => ({ selected: [], svg: [], other: '', text: '' })

export default function QuestionsTab({
  spec,
  onContinue,
  running,
}: {
  spec: QuestionSpec
  onContinue: (content: string) => void
  running: boolean
}) {
  const t = useT()
  const questions = Array.isArray(spec.questions) ? spec.questions : []
  const [ans, setAns] = useState<Record<string, Answer>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, blank()])),
  )

  const get = (id: string) => ans[id] ?? blank()
  const set = (id: string, patch: Partial<Answer>) => setAns((s) => ({ ...s, [id]: { ...get(id), ...patch } }))

  const toggleOpt = (q: Question, opt: string) => {
    const a = get(q.id)
    if (q.multi) {
      set(q.id, { selected: a.selected.includes(opt) ? a.selected.filter((o) => o !== opt) : [...a.selected, opt] })
    } else {
      set(q.id, { selected: a.selected[0] === opt ? [] : [opt] })
    }
  }
  const toggleSvg = (q: Question, i: number) => {
    const a = get(q.id)
    if (q.multi) {
      set(q.id, { svg: a.svg.includes(i) ? a.svg.filter((x) => x !== i) : [...a.svg, i] })
    } else {
      set(q.id, { svg: a.svg[0] === i ? [] : [i] })
    }
  }

  const submit = () => {
    if (running) return
    const lines = questions.map((q) => {
      const a = get(q.id)
      let val: string
      if (q.kind === 'freeform') val = a.text.trim()
      else if (q.kind === 'svg-options')
        val = a.svg.map((i) => t('questions.option_n', { n: i + 1 })).join(t('questions.list_sep')) || (a.other.trim() ?? '')
      else val = [...a.selected, a.other.trim()].filter(Boolean).join(t('questions.list_sep'))
      return `- ${q.title}${t('questions.kv_sep')}${val || t('questions.no_preference')}`
    })
    onContinue((spec.title ? `${spec.title}\n` : '') + lines.join('\n'))
  }

  return (
    <div className="relative h-full bg-paper">
      <div className="thin-scrollbar h-full overflow-auto">
        <div className="mx-auto max-w-[920px] px-12 py-12 pb-28">
          {spec.title && <h1 className="mb-9 text-[28px] font-semibold tracking-tight text-ink">{spec.title}</h1>}

          <div className="space-y-9">
            {questions.map((q) => {
              const a = get(q.id)
              return (
                <div key={q.id}>
                  <div className="text-[16px] font-semibold text-ink">{q.title}</div>
                  {q.subtitle ? (
                    <div className="mt-1 text-[13.5px] leading-relaxed text-ink-muted">{q.subtitle}</div>
                  ) : (
                    q.multi && <div className="mt-1 text-[13px] text-ink-muted">{t('questions.multi_select')}</div>
                  )}

                  {q.kind === 'freeform' ? (
                    <div className="relative mt-3">
                      <textarea
                        value={a.text}
                        onChange={(e) => set(q.id, { text: e.target.value })}
                        rows={4}
                        placeholder={t('questions.answer_placeholder')}
                        className="w-full resize-none rounded-2xl border border-line bg-white px-4 py-3 text-[14px] text-ink placeholder:text-ink-faint focus:border-coral-muted focus:outline-none"
                      />
                      <ImageIcon size={16} className="pointer-events-none absolute bottom-3 right-3.5 text-ink-faint" />
                    </div>
                  ) : q.kind === 'svg-options' ? (
                    <div className="mt-3 flex flex-wrap gap-3">
                      {(q.options ?? []).map((svg, i) => {
                        const active = a.svg.includes(i)
                        return (
                          <button
                            key={i}
                            onClick={() => toggleSvg(q, i)}
                            className={
                              'grid h-[110px] w-[150px] place-items-center rounded-xl border bg-white p-3 transition-colors ' +
                              (active ? 'border-coral ring-2 ring-coral/30' : 'border-line hover:border-line-strong')
                            }
                            dangerouslySetInnerHTML={{ __html: svg }}
                          />
                        )
                      })}
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center gap-2.5">
                      {(q.options ?? []).map((opt) => {
                        const active = a.selected.includes(opt)
                        return (
                          <button
                            key={opt}
                            onClick={() => toggleOpt(q, opt)}
                            className={
                              'flex items-center gap-1.5 rounded-full border px-4 py-2 text-[14px] transition-colors ' +
                              (active
                                ? 'border-coral bg-coral-tint text-ink'
                                : 'border-line bg-white text-ink-soft hover:border-line-strong')
                            }
                          >
                            {active && <Check size={14} className="text-coral-dark" />}
                            {opt}
                          </button>
                        )
                      })}
                      <input
                        value={a.other}
                        onChange={(e) => set(q.id, { other: e.target.value })}
                        placeholder={t('questions.other_placeholder')}
                        className="min-w-[180px] rounded-full border border-line bg-white px-4 py-2 text-[14px] text-ink placeholder:text-ink-faint focus:border-coral-muted focus:outline-none"
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* floating Continue */}
      <button
        onClick={submit}
        disabled={running}
        className="absolute bottom-6 right-8 rounded-xl bg-coral px-7 py-2.5 text-[14px] font-medium text-white shadow-pop transition-colors hover:bg-coral-dark disabled:bg-coral-muted"
      >
        {t('questions.continue')}
      </button>
    </div>
  )
}
