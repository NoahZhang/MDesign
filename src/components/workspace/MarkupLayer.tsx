import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ArrowUpRight, Pen, Send, Square, Trash2, Type as TypeIcon, Undo2 } from 'lucide-react'
import { useT } from '../../lib/i18n'

export type Shape =
  | { id: string; type: 'box'; x: number; y: number; w: number; h: number; color: string }
  | { id: string; type: 'arrow'; x1: number; y1: number; x2: number; y2: number; color: string }
  | { id: string; type: 'pen'; points: [number, number][]; color: string }
  | { id: string; type: 'text'; x: number; y: number; text: string; color: string }

type Tool = 'box' | 'arrow' | 'pen' | 'text'
const COLORS = ['#D97757', '#E5484D', '#2B8A3E', '#1971C2', '#1F1E1B']
let _id = 0
const nid = () => 'm' + ++_id

function normalize(s: Shape): Shape {
  if (s.type === 'box') {
    return { ...s, x: Math.min(s.x, s.x + s.w), y: Math.min(s.y, s.y + s.h), w: Math.abs(s.w), h: Math.abs(s.h) }
  }
  return s
}

function ArrowHead({ x1, y1, x2, y2, color }: { x1: number; y1: number; x2: number; y2: number; color: string }) {
  const ang = Math.atan2(y2 - y1, x2 - x1)
  const len = 11
  const a1 = ang + Math.PI * 0.82
  const a2 = ang - Math.PI * 0.82
  return (
    <>
      <line x1={x2} y1={y2} x2={x2 + len * Math.cos(a1)} y2={y2 + len * Math.sin(a1)} stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      <line x1={x2} y1={y2} x2={x2 + len * Math.cos(a2)} y2={y2 + len * Math.sin(a2)} stroke={color} strokeWidth={2.5} strokeLinecap="round" />
    </>
  )
}

function renderShape(s: Shape) {
  if (s.type === 'box') {
    const n = normalize(s) as Extract<Shape, { type: 'box' }>
    return <rect key={s.id} x={n.x} y={n.y} width={n.w} height={n.h} fill="none" stroke={s.color} strokeWidth={2.5} rx={4} />
  }
  if (s.type === 'arrow') {
    return (
      <g key={s.id}>
        <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} strokeWidth={2.5} strokeLinecap="round" />
        <ArrowHead {...s} />
      </g>
    )
  }
  if (s.type === 'pen') {
    return <polyline key={s.id} points={s.points.map((p) => p.join(',')).join(' ')} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
  }
  return null
}

export default function MarkupLayer({ onSend, onClose }: { onSend: (shapes: Shape[], note: string) => void; onClose: () => void }) {
  const t = useT()
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState(COLORS[0])
  const [shapes, setShapes] = useState<Shape[]>([])
  const [note, setNote] = useState('')
  const [draft, setDraft] = useState<Shape | null>(null)
  const [textInput, setTextInput] = useState<{ x: number; y: number; value: string } | null>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)

  const local = (e: ReactPointerEvent): [number, number] => {
    const r = surfaceRef.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  const down = (e: ReactPointerEvent) => {
    if (textInput) return
    const [x, y] = local(e)
    if (tool === 'text') {
      setTextInput({ x, y, value: '' })
      return
    }
    surfaceRef.current?.setPointerCapture(e.pointerId)
    if (tool === 'box') setDraft({ id: nid(), type: 'box', x, y, w: 0, h: 0, color })
    else if (tool === 'arrow') setDraft({ id: nid(), type: 'arrow', x1: x, y1: y, x2: x, y2: y, color })
    else setDraft({ id: nid(), type: 'pen', points: [[x, y]], color })
  }
  const move = (e: ReactPointerEvent) => {
    if (!draft) return
    const [x, y] = local(e)
    setDraft((d) => {
      if (!d) return d
      if (d.type === 'box') return { ...d, w: x - d.x, h: y - d.y }
      if (d.type === 'arrow') return { ...d, x2: x, y2: y }
      if (d.type === 'pen') return { ...d, points: [...d.points, [x, y]] }
      return d
    })
  }
  const up = () => {
    if (!draft) return
    const keep =
      (draft.type === 'box' && (Math.abs(draft.w) > 4 || Math.abs(draft.h) > 4)) ||
      (draft.type === 'arrow' && (Math.abs(draft.x2 - draft.x1) > 4 || Math.abs(draft.y2 - draft.y1) > 4)) ||
      (draft.type === 'pen' && draft.points.length > 2)
    if (keep) setShapes((s) => [...s, normalize(draft)])
    setDraft(null)
  }

  const commitText = () => {
    if (textInput && textInput.value.trim()) {
      setShapes((s) => [...s, { id: nid(), type: 'text', x: textInput.x, y: textInput.y, text: textInput.value.trim(), color }])
    }
    setTextInput(null)
  }

  const textShapes = shapes.filter((s): s is Extract<Shape, { type: 'text' }> => s.type === 'text')
  const TOOLS: { id: Tool; icon: typeof Square; label: string }[] = [
    { id: 'box', icon: Square, label: t('markup.box') },
    { id: 'arrow', icon: ArrowUpRight, label: t('markup.arrow') },
    { id: 'pen', icon: Pen, label: t('markup.pen') },
    { id: 'text', icon: TypeIcon, label: t('markup.text') },
  ]

  return (
    <div className="absolute inset-0 z-30">
      <div
        ref={surfaceRef}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        className="absolute inset-0 cursor-crosshair"
        style={{ touchAction: 'none' }}
      >
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          {shapes.map(renderShape)}
          {draft && renderShape(draft)}
        </svg>
        {textShapes.map((t) => (
          <div
            key={t.id}
            className="pointer-events-none absolute max-w-[220px] rounded-md px-2 py-1 text-[12.5px] font-medium shadow-card"
            style={{ left: t.x, top: t.y, background: t.color, color: '#fff' }}
          >
            {t.text}
          </div>
        ))}
        {textInput && (
          <input
            autoFocus
            value={textInput.value}
            onChange={(e) => setTextInput({ ...textInput, value: e.target.value })}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) commitText()
              if (e.key === 'Escape') setTextInput(null)
            }}
            placeholder={t('markup.text_placeholder')}
            className="absolute rounded-md border-2 px-2 py-1 text-[12.5px] shadow-pop focus:outline-none"
            style={{ left: textInput.x, top: textInput.y, borderColor: color, color: '#1F1E1B' }}
          />
        )}
      </div>

      {/* toolbar */}
      <div className="absolute bottom-5 left-1/2 flex w-[min(720px,94%)] -translate-x-1/2 items-center gap-1 rounded-2xl border border-line bg-white/95 p-1.5 shadow-pop backdrop-blur">
        {TOOLS.map((t) => {
          const Icon = t.icon
          const active = tool === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              title={t.label}
              className={
                'grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors ' +
                (active ? 'bg-ink text-white' : 'text-ink-muted hover:bg-sink')
              }
            >
              <Icon size={16} />
            </button>
          )
        })}
        <div className="mx-1 flex shrink-0 items-center gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={'h-5 w-5 rounded-full border transition-transform ' + (color === c ? 'scale-110 border-ink' : 'border-line')}
              style={{ background: c }}
            />
          ))}
        </div>
        <button
          onClick={() => setShapes((s) => s.slice(0, -1))}
          title={t('markup.undo')}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-muted hover:bg-sink"
        >
          <Undo2 size={16} />
        </button>
        <button
          onClick={() => setShapes([])}
          title={t('markup.clear')}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-muted hover:bg-sink"
        >
          <Trash2 size={16} />
        </button>
        <div className="mx-1 h-6 w-px shrink-0 bg-line" />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              if (note.trim() || shapes.length) onSend(shapes, note)
            }
          }}
          placeholder={t('markup.note_placeholder')}
          className="min-w-0 flex-1 rounded-lg bg-panel px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none"
        />
        <button onClick={onClose} className="shrink-0 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-sink">
          {t('common.cancel')}
        </button>
        <button
          onClick={() => onSend(shapes, note)}
          disabled={!note.trim() && shapes.length === 0}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-coral px-3.5 py-2 text-[13px] font-medium text-white hover:bg-coral-dark disabled:bg-coral-muted"
        >
          <Send size={14} /> {t('markup.send')}
        </button>
      </div>
    </div>
  )
}
