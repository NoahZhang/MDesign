import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Loader2, Pencil } from 'lucide-react'
import { buildSlideDoc, parseDeckHtml, SLIDE_H, SLIDE_W } from '../../lib/deckHtml'
import { exportHtmlToPptx } from '../../lib/htmlToPptx'
import { getProject, writeFile } from '../../lib/store'
import { useT } from '../../lib/i18n'
import { replaceFlexible } from '../../lib/textEdit'
import type { Project } from '../../lib/types'

const THUMB_W = 168

export default function DeckView({ project, path }: { project: Project; path: string }) {
  const t = useT()
  const file = project.files.find((f) => f.path === path)
  const { head, slides } = useMemo(() => (file ? parseDeckHtml(file.content) : { head: '', slides: [] }), [file?.content])
  // Memoize on the deck's own content (head/slides derive from it), NOT the whole project.files —
  // otherwise every unrelated store update would reload all N thumbnail iframes. project.files is
  // read at compute time to inline assets (rare to change mid-edit).
  const docs = useMemo(() => slides.map((s) => buildSlideDoc(head, s, project.files)), [slides, head])

  const [idx, setIdx] = useState(0)
  const [scale, setScale] = useState(1)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const slideRef = useRef<HTMLIFrameElement>(null)

  const n = docs.length
  const cur = Math.min(idx, Math.max(0, n - 1))

  // While editing, freeze the active slide's document: each saved edit mutates the source (and
  // thus docs[cur]); without freezing, the iframe would reload and wipe an in-progress edit.
  // Re-capture only when the slide or edit mode changes (not on content saves).
  const frozenDoc = useRef('')
  const docKey = useRef('')
  const key = `${cur}|${editing}`
  if (docKey.current !== key) {
    docKey.current = key
    frozenDoc.current = docs[cur] ?? ''
  }
  const activeDoc = editing ? frozenDoc.current : docs[cur] ?? ''

  useEffect(() => {
    setIdx(0)
  }, [path])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => setScale(Math.max(0.05, Math.min((el.clientWidth - 48) / SLIDE_W, (el.clientHeight - 48) / SLIDE_H)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!n) return
    const onKey = (e: KeyboardEvent) => {
      if (editing) return
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') setIdx((i) => Math.min(i + 1, n - 1))
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') setIdx((i) => Math.max(i - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [n, editing])

  // Inline text editing on the active slide: double-click a text element, edit it, and on blur
  // write the change back into the deck's HTML source (matched whitespace-tolerantly).
  const attachEditing = () => {
    const doc = slideRef.current?.contentDocument
    if (!doc) return
    const origs = new WeakMap<HTMLElement, string>()
    const onDbl = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.('*') as HTMLElement | null
      if (!el || el.children.length > 0 || !(el.textContent || '').trim()) return
      origs.set(el, el.textContent || '')
      el.setAttribute('contenteditable', 'true')
      el.style.outline = '2px solid #D97757'
      el.focus()
    }
    const onBlur = (e: Event) => {
      const el = e.target as HTMLElement
      if (!origs.has(el)) return
      el.removeAttribute('contenteditable')
      el.style.outline = ''
      const orig = (origs.get(el) || '').replace(/\s+/g, ' ').trim()
      const now = (el.textContent || '').replace(/\s+/g, ' ').trim()
      origs.delete(el)
      if (!orig || !now || orig === now) return
      // Read the LATEST source from the store, not the closed-over `file`, so a quick second edit
      // doesn't overwrite the first one's (not-yet-reflected) change.
      const src = getProject(project.id)?.files.find((f) => f.path === path)?.content
      if (!src) return
      const next = replaceFlexible(src, orig, now)
      if (next) writeFile(project.id, path, next)
    }
    doc.addEventListener('dblclick', onDbl, true)
    doc.addEventListener('blur', onBlur, true)
  }

  const name = (path.split('/').pop() || t('deck.untitled')).replace(/\.html?$/i, '')
  const exportPptx = async () => {
    if (!file) return
    setBusy(true)
    try {
      await exportHtmlToPptx(file.content, name, project.files)
    } finally {
      setBusy(false)
    }
  }

  if (!file) return <div className="grid h-full place-items-center bg-paper text-[14px] text-ink-faint">{t('deck.file_removed')}</div>

  return (
    <div className="flex h-full flex-col bg-paper">
      <div className="flex items-center gap-2 border-b border-line bg-panel px-4 py-2">
        <button onClick={() => setIdx((i) => Math.max(i - 1, 0))} disabled={cur <= 0} className="grid h-8 w-8 place-items-center rounded-md text-ink-muted hover:bg-sink disabled:opacity-40" title={t('deck.prev')}>
          <ChevronLeft size={16} />
        </button>
        <span className="min-w-[52px] text-center text-[13px] tabular-nums text-ink-soft">{n ? cur + 1 : 0} / {n}</span>
        <button onClick={() => setIdx((i) => Math.min(i + 1, n - 1))} disabled={cur >= n - 1} className="grid h-8 w-8 place-items-center rounded-md text-ink-muted hover:bg-sink disabled:opacity-40" title={t('deck.next')}>
          <ChevronRight size={16} />
        </button>
        <span className="truncate pl-1 text-[13px] font-medium text-ink">{name}</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setEditing((v) => !v)}
            className={'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors ' + (editing ? 'bg-coral-tint text-coral-dark' : 'text-ink-muted hover:bg-sink')}
            title={t('deck.edit_tip')}
          >
            <Pencil size={14} /> {editing ? t('deck.editing') : t('common.edit')}
          </button>
          <button onClick={exportPptx} disabled={busy || !n} className="flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-[13px] font-medium text-white hover:bg-ink-soft disabled:opacity-50" title={t('deck.export_tip')}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} {t('deck.download_pptx')}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* left: slide thumbnails */}
        <div className="thin-scrollbar w-[204px] shrink-0 overflow-y-auto border-r border-line bg-panel p-3">
          <div className="space-y-2.5">
            {docs.map((doc, i) => (
              <button key={i} onClick={() => setIdx(i)} className="flex w-full items-center gap-2 text-left">
                <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-ink-faint">{i + 1}</span>
                <span
                  className={'relative block shrink-0 overflow-hidden rounded-md border bg-white ' + (i === cur ? 'border-coral ring-2 ring-coral/30' : 'border-line')}
                  style={{ width: THUMB_W, height: THUMB_W * (SLIDE_H / SLIDE_W) }}
                >
                  <iframe
                    title={`thumb-${i}`}
                    srcDoc={doc}
                    scrolling="no"
                    tabIndex={-1}
                    sandbox="allow-same-origin"
                    className="pointer-events-none border-0 bg-white"
                    style={{ width: SLIDE_W, height: SLIDE_H, transform: `scale(${THUMB_W / SLIDE_W})`, transformOrigin: 'top left' }}
                  />
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* right: active slide preview (centered, unobstructed) */}
        <div ref={stageRef} className="relative min-w-0 flex-1 overflow-hidden bg-[#15140f]">
          {activeDoc && (
            <iframe
              ref={slideRef}
              key={cur + (editing ? '-e' : '')}
              title="slide"
              srcDoc={activeDoc}
              onLoad={() => editing && attachEditing()}
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                width: SLIDE_W,
                height: SLIDE_H,
                transform: `translate(-50%, -50%) scale(${scale})`,
                transformOrigin: 'center',
                border: 0,
                background: '#fff',
                boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
