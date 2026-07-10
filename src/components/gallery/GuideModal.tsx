import { X } from 'lucide-react'
import { PaletteMark } from '../Logo'
import { useT } from '../../lib/i18n'

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-5">
      <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
        <span className="grid h-5 w-5 place-items-center rounded-md bg-sink text-[11px] font-semibold text-ink-muted">
          {n}
        </span>
        {title}
      </h3>
      <div className="mt-2 space-y-1.5 pl-7 text-[13.5px] leading-relaxed text-ink-soft">{children}</div>
    </section>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-sink px-1.5 py-0.5 font-mono text-[12px] text-ink">{children}</span>
}

export default function GuideModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/25 p-6" onClick={onClose}>
      <div
        className="my-8 w-full max-w-[640px] rounded-2xl border border-line bg-panel shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div className="flex items-center gap-2.5">
            <PaletteMark size={26} />
            <div>
              <div className="wordmark text-[18px] font-medium text-ink">{t('guide.title')}</div>
              <div className="text-[12px] text-ink-muted">{t('guide.subtitle')}</div>
            </div>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md text-ink-muted hover:bg-sink">
            <X size={17} />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <p className="text-[13.5px] leading-relaxed text-ink-soft">
            {t('guide.intro_before')}
            <strong className="font-semibold text-ink">{t('guide.intro_emph')}</strong>
            {t('guide.intro_after')}
          </p>

          <Section n="1" title={t('guide.step1_title')}>
            <p>{t('guide.step1_p1')}</p>
            <p>{t('guide.step1_p2')}</p>
          </Section>

          <Section n="2" title={t('guide.step2_title')}>
            <p>{t('guide.step2_p1')}</p>
            <p>
              {t('guide.step2_p2_a')}
              <strong className="font-semibold text-ink">Questions</strong>
              {t('guide.step2_p2_b')}
              <Pill>Continue</Pill>
              {t('guide.step2_p2_c')}
            </p>
            <p>{t('guide.step2_p3')}</p>
          </Section>

          <Section n="3" title={t('guide.step3_title')}>
            <p>
              {t('guide.step3_p1_a')}
              <strong className="font-semibold text-ink">{t('guide.step3_p1_click')}</strong>
              {t('guide.step3_p1_b')}
              <strong className="font-semibold text-ink">{t('guide.step3_p1_dblclick')}</strong>
              {t('guide.step3_p1_c')}
            </p>
            <p>
              {t('guide.step3_p2_a')}
              <Pill>Present</Pill>
              {t('guide.step3_p2_b')}
            </p>
          </Section>

          <Section n="4" title={t('guide.step4_title')}>
            <p>
              <strong className="font-semibold text-ink">Edit</strong>
              {t('guide.step4_edit')}
            </p>
            <p>
              <strong className="font-semibold text-ink">Tweaks</strong>
              {t('guide.step4_tweaks')}
            </p>
            <p>
              <strong className="font-semibold text-ink">Mark up</strong>
              {t('guide.step4_markup')}
            </p>
          </Section>

          <Section n="5" title={t('guide.step5_title')}>
            <p>
              {t('guide.step5_p1_a')}
              <Pill>ark-code-latest</Pill>
              {t('guide.step5_p1_b')}
            </p>
            <p>{t('guide.step5_p2')}</p>
          </Section>

          <Section n="6" title={t('guide.step6_title')}>
            <p>{t('guide.step6_p1')}</p>
            <p>{t('guide.step6_p2')}</p>
          </Section>
        </div>

        <div className="border-t border-line px-6 py-4">
          <button onClick={onClose} className="w-full rounded-lg bg-ink py-2.5 text-[14px] font-medium text-white hover:bg-ink-soft">
            {t('guide.get_started')}
          </button>
        </div>
      </div>
    </div>
  )
}
