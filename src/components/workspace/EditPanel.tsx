import { X } from 'lucide-react'
import { useT } from '../../lib/i18n'

export type EditValues = Record<string, string>

const FONTS = ['inherit', 'JetBrains Mono', 'Newsreader', 'Hanken Grotesk', 'Georgia', 'system-ui', 'Arial']
const WEIGHTS = ['300', '400', '500', '600', '700', '800']
const ALIGNS = ['left', 'center', 'right', 'justify']

function Section({ title }: { title: string }) {
  return <div className="px-4 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{title}</div>
}

function Box({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-white px-3 py-2">
      <span className="shrink-0 text-[12px] text-ink-muted">{label}</span>
      {children}
    </div>
  )
}

function Num({ value, onChange, unit }: { value: string; onChange: (v: string) => void; unit?: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-14 bg-transparent text-right text-[13px] tabular-nums text-ink focus:outline-none"
      />
      {unit && <span className="text-[11px] text-ink-faint">{unit}</span>}
    </span>
  )
}

function Select({
  value,
  options,
  onChange,
}: {
  value: string
  options: string[]
  onChange: (v: string) => void
}) {
  return (
    <select
      value={options.includes(value) ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      className="max-w-[140px] truncate bg-transparent text-right text-[13px] text-ink focus:outline-none"
    >
      {!options.includes(value) && <option value="">{value}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}

export default function EditPanel({
  values,
  onChange,
  onClose,
}: {
  values: EditValues | null
  onChange: (key: string, value: string) => void
  onClose: () => void
}) {
  const t = useT()
  const v = values
  const set = (k: string) => (val: string) => onChange(k, val)

  return (
    <div className="thin-scrollbar flex h-full w-full flex-col overflow-y-auto bg-panel">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel px-4 py-2.5">
        <span className="text-[14px] font-semibold text-ink">{t('common.edit')}</span>
        <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-md text-ink-muted hover:bg-sink">
          <X size={15} />
        </button>
      </div>

      {!v ? (
        <p className="px-4 py-5 text-[12.5px] leading-relaxed text-ink-muted">
          {t('edit.empty')}
        </p>
      ) : (
        <div className="pb-6">
          <Section title={t('edit.typography')} />
          <div className="space-y-2 px-4">
            <Box label={t('edit.font')}>
              <Select value={v.font} options={FONTS} onChange={set('font')} />
            </Box>
            <div className="grid grid-cols-2 gap-2">
              <Box label={t('edit.size')}>
                <Num value={v.size} onChange={set('size')} unit="px" />
              </Box>
              <Box label={t('edit.weight')}>
                <Select value={v.weight} options={WEIGHTS} onChange={set('weight')} />
              </Box>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Box label={t('edit.color')}>
                <span className="flex items-center gap-2">
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(v.color) ? v.color : '#000000'}
                    onChange={(e) => onChange('color', e.target.value)}
                    className="h-5 w-5 shrink-0 cursor-pointer rounded border border-line p-0"
                  />
                  <input
                    value={v.color}
                    onChange={(e) => onChange('color', e.target.value)}
                    className="w-16 bg-transparent text-right text-[12px] text-ink focus:outline-none"
                  />
                </span>
              </Box>
              <Box label={t('edit.align')}>
                <Select value={v.align} options={ALIGNS} onChange={set('align')} />
              </Box>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Box label={t('edit.line_height')}>
                <Num value={v.lineHeight} onChange={set('lineHeight')} />
              </Box>
              <Box label={t('edit.tracking')}>
                <Num value={v.tracking} onChange={set('tracking')} unit="px" />
              </Box>
            </div>
          </div>

          <Section title={t('edit.size_section')} />
          <div className="grid grid-cols-2 gap-2 px-4">
            <Box label={t('edit.width')}>
              <Num value={v.width} onChange={set('width')} unit="px" />
            </Box>
            <Box label={t('edit.height')}>
              <Num value={v.height} onChange={set('height')} unit="px" />
            </Box>
          </div>

          <Section title={t('edit.box_section')} />
          <div className="space-y-2 px-4">
            <Box label={t('edit.opacity')}>
              <Num value={v.opacity} onChange={set('opacity')} unit="%" />
            </Box>
            <Box label={t('edit.padding')}>
              <Num value={v.padding} onChange={set('padding')} unit="px" />
            </Box>
            <Box label={t('edit.margin')}>
              <Num value={v.margin} onChange={set('margin')} unit="px" />
            </Box>
            <Box label={t('edit.border')}>
              <Num value={v.border} onChange={set('border')} unit="px" />
            </Box>
            <Box label={t('edit.border_radius')}>
              <Num value={v.radius} onChange={set('radius')} unit="px" />
            </Box>
          </div>
        </div>
      )}
    </div>
  )
}
