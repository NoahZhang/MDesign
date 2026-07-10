import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronLeft, MessageSquareText, PenLine, Plus, RotateCw, Type, X } from 'lucide-react'
import { writeFile } from '../../lib/store'
import { useT } from '../../lib/i18n'
import { fileKind } from '../../lib/types'
import { resolveHtml, resolvePageHref } from '../../lib/resolveHtml'
import { escapeRe, replaceFlexible } from '../../lib/textEdit'
import { isDeckHtml } from '../../lib/deckHtml'
import type { Project } from '../../lib/types'
import DeckView from './DeckView'
import EditPanel, { type EditValues } from './EditPanel'
import MarkupLayer, { type Shape } from './MarkupLayer'

const ZOOMS = [50, 75, 90, 100, 110, 125, 150, 175, 200]

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// Paint markup shapes (in iframe-viewport coords; ox/oy = scroll offsets) onto a 2D context,
// mirroring MarkupLayer's SVG rendering, so the sent screenshot shows the annotations.
function paintShapes(ctx: CanvasRenderingContext2D, shapes: Shape[], ox: number, oy: number) {
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.font = '600 13px -apple-system, system-ui, sans-serif'
  ctx.textBaseline = 'alphabetic'
  for (const s of shapes) {
    ctx.strokeStyle = s.color
    if (s.type === 'box') {
      ctx.strokeRect(s.x + ox, s.y + oy, s.w, s.h)
    } else if (s.type === 'arrow') {
      const x1 = s.x1 + ox, y1 = s.y1 + oy, x2 = s.x2 + ox, y2 = s.y2 + oy
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      const a = Math.atan2(y2 - y1, x2 - x1)
      const L = 11
      ctx.beginPath()
      ctx.moveTo(x2, y2)
      ctx.lineTo(x2 + L * Math.cos(a + Math.PI * 0.82), y2 + L * Math.sin(a + Math.PI * 0.82))
      ctx.moveTo(x2, y2)
      ctx.lineTo(x2 + L * Math.cos(a - Math.PI * 0.82), y2 + L * Math.sin(a - Math.PI * 0.82))
      ctx.stroke()
    } else if (s.type === 'pen') {
      ctx.beginPath()
      s.points.forEach((p, i) => (i ? ctx.lineTo(p[0] + ox, p[1] + oy) : ctx.moveTo(p[0] + ox, p[1] + oy)))
      ctx.stroke()
    } else if (s.type === 'text') {
      const tx = s.x + ox, ty = s.y + oy
      const w = ctx.measureText(s.text).width + 12
      ctx.fillStyle = s.color
      roundRectPath(ctx, tx, ty, w, 22, 4)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.fillText(s.text, tx + 6, ty + 15)
    }
  }
}

interface CssVar {
  name: string
  value: string
}
function parseVars(content: string): CssVar[] {
  const root = content.match(/:root\s*\{([^}]*)\}/)
  if (!root) return []
  const out: CssVar[] = []
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g
  let m: RegExpExecArray | null
  while ((m = re.exec(root[1]))) out.push({ name: m[1], value: m[2].trim() })
  return out
}

function rgbToHex(c: string): string {
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!m) return c
  const h = (x: number) => x.toString(16).padStart(2, '0')
  return '#' + h(+m[1]) + h(+m[2]) + h(+m[3])
}
function num(v: string): string {
  const f = parseFloat(v)
  return isNaN(f) ? '0' : String(Math.round(f * 100) / 100)
}

function readValues(el: HTMLElement): EditValues {
  const cs = (el.ownerDocument.defaultView || window).getComputedStyle(el)
  const fam = (cs.fontFamily || '').split(',')[0].replace(/['"]/g, '').trim()
  const fs = parseFloat(cs.fontSize) || 16
  return {
    font: fam || 'inherit',
    size: num(cs.fontSize),
    weight: cs.fontWeight || '400',
    color: rgbToHex(cs.color),
    align: cs.textAlign || 'left',
    lineHeight: cs.lineHeight === 'normal' ? '1.2' : String(Math.round((parseFloat(cs.lineHeight) / fs) * 100) / 100),
    tracking: cs.letterSpacing === 'normal' ? '0' : num(cs.letterSpacing),
    width: num(cs.width),
    height: num(cs.height),
    opacity: String(Math.round(parseFloat(cs.opacity || '1') * 100)),
    padding: num(cs.paddingTop),
    margin: num(cs.marginTop),
    border: num(cs.borderTopWidth),
    radius: num(cs.borderTopLeftRadius),
  }
}

function applyProp(el: HTMLElement, key: string, value: string): [string, string][] {
  const s = el.style
  switch (key) {
    case 'font':
      s.fontFamily = value
      return [['font-family', value]]
    case 'size':
      s.fontSize = value + 'px'
      return [['font-size', value + 'px']]
    case 'weight':
      s.fontWeight = value
      return [['font-weight', value]]
    case 'color':
      s.color = value
      return [['color', value]]
    case 'align':
      s.textAlign = value
      return [['text-align', value]]
    case 'lineHeight':
      s.lineHeight = value
      return [['line-height', value]]
    case 'tracking':
      s.letterSpacing = value + 'px'
      return [['letter-spacing', value + 'px']]
    case 'width':
      s.width = value + 'px'
      return [['width', value + 'px']]
    case 'height':
      s.height = value + 'px'
      return [['height', value + 'px']]
    case 'opacity': {
      const o = String(Number(value) / 100)
      s.opacity = o
      return [['opacity', o]]
    }
    case 'padding':
      s.padding = value + 'px'
      return [['padding', value + 'px']]
    case 'margin':
      s.margin = value + 'px'
      return [['margin', value + 'px']]
    case 'border':
      s.borderWidth = value + 'px'
      if (!s.borderStyle || s.borderStyle === 'none') s.borderStyle = 'solid'
      return [
        ['border-width', value + 'px'],
        ['border-style', 'solid'],
      ]
    case 'radius':
      s.borderRadius = value + 'px'
      return [['border-radius', value + 'px']]
  }
  return []
}

// Non-intrusive hover highlight box that follows the element under the cursor
// (doesn't touch element styles, so it never clashes with selection outlines).
function createHoverBox(doc: Document) {
  const box = doc.createElement('div')
  box.id = '__hoverbox'
  box.style.cssText =
    'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #D97757;' +
    'border-radius:2px;background:rgba(217,119,87,0.08);box-sizing:border-box;display:none;'
  doc.body.appendChild(box)
  return {
    node: box,
    show(el: HTMLElement) {
      const r = el.getBoundingClientRect()
      box.style.display = 'block'
      box.style.left = `${r.left}px`
      box.style.top = `${r.top}px`
      box.style.width = `${r.width}px`
      box.style.height = `${r.height}px`
    },
    hide() {
      box.style.display = 'none'
    },
    remove() {
      box.remove()
    },
  }
}

interface CommentPin {
  x: number
  y: number
  selector: string
  label: string
  style: string
  comment: string
}

function selectorFor(el: HTMLElement): string {
  const parts: string[] = []
  let node: Element | null = el
  while (node && node.nodeType === 1 && node.tagName !== 'HTML') {
    if (node.id) {
      parts.unshift('#' + CSS.escape(node.id))
      break
    }
    if (node.tagName === 'BODY') {
      parts.unshift('body')
      break
    }
    let seg = node.tagName.toLowerCase()
    const parent: Element | null = node.parentElement
    if (parent) {
      const sib = Array.from(parent.children).filter((c) => c.tagName === node!.tagName)
      if (sib.length > 1) seg += `:nth-of-type(${sib.indexOf(node) + 1})`
    }
    parts.unshift(seg)
    node = node.parentElement
  }
  return parts.join(' > ')
}

function parseEdits(content: string): Map<string, Record<string, string>> {
  const map = new Map<string, Record<string, string>>()
  const m = content.match(/<style id="__edits">([\s\S]*?)<\/style>/)
  if (!m) return map
  const ruleRe = /([^{}]+)\{([^}]*)\}/g
  let r: RegExpExecArray | null
  while ((r = ruleRe.exec(m[1]))) {
    const sel = r[1].trim()
    const props: Record<string, string> = {}
    r[2].split(';').forEach((d) => {
      const i = d.indexOf(':')
      if (i > 0) props[d.slice(0, i).trim()] = d.slice(i + 1).replace(/!important/i, '').trim()
    })
    if (sel && Object.keys(props).length) map.set(sel, props)
  }
  return map
}

function ToolBtn({
  icon,
  label,
  onClick,
  active,
  title,
}: {
  icon: ReactNode
  label: string
  onClick?: () => void
  active?: boolean
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={
        'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors ' +
        (active ? 'bg-sink text-ink' : 'text-ink-muted hover:bg-sink hover:text-ink')
      }
    >
      <span className={active ? 'text-coral-dark' : 'text-ink-muted'}>{icon}</span>
      {label}
    </button>
  )
}

export default function FileTabView({
  project,
  path,
  chatWidth,
  onSendToChat,
}: {
  project: Project
  path: string
  chatWidth: number
  onSendToChat: (text: string, images?: { data: string; mimeType: string }[]) => void
}) {
  const t = useT()
  const file = project.files.find((f) => f.path === path)
  const [reload, setReload] = useState(0)
  const [zoom, setZoom] = useState(100)
  const [mode, setMode] = useState<'view' | 'edit' | 'tweaks' | 'markup' | 'comments'>('view')
  const [pins, setPins] = useState<CommentPin[]>([])
  const [draftPin, setDraftPin] = useState<Omit<CommentPin, 'comment'> | null>(null)
  const [draftText, setDraftText] = useState('')
  // latest draftPin for the iframe click handler (which is set up once per file/mode)
  const draftPinRef = useRef<Omit<CommentPin, 'comment'> | null>(null)
  draftPinRef.current = draftPin
  const [tweaks, setTweaks] = useState<Record<string, string>>({})
  const [selProps, setSelProps] = useState<EditValues | null>(null)
  const [zoomMenu, setZoomMenu] = useState(false)
  const [currentPath, setCurrentPath] = useState(path)
  const [navStack, setNavStack] = useState<string[]>([])
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const selRef = useRef<HTMLElement | null>(null)
  const styleEditsRef = useRef<Map<string, Record<string, string>>>(new Map())
  const textOrigRef = useRef<Map<HTMLElement, string>>(new Map())

  // The page actually shown — may differ from the tab's file after a link click.
  const view = project.files.find((f) => f.path === currentPath) ?? file
  const kind = view ? fileKind(view.path) : 'doc'
  const isHtml = kind === 'page'
  const isImage = !!view && view.content.startsWith('data:image')
  const isSvg = !!view && view.path.toLowerCase().endsWith('.svg') && !isImage

  const vars = useMemo(() => (view && isHtml ? parseVars(view.content) : []), [view?.content, isHtml])

  useEffect(() => {
    setMode('view')
    setTweaks({})
    setCurrentPath(path)
    setNavStack([])
  }, [path])

  const applyTweaks = (next: Record<string, string>) => {
    const doc = iframeRef.current?.contentDocument
    if (!doc) return
    try {
      let style = doc.getElementById('__tweaks') as HTMLStyleElement | null
      if (!style) {
        style = doc.createElement('style')
        style.id = '__tweaks'
        doc.head.appendChild(style)
      }
      style.textContent = `:root{${Object.entries(next)
        .map(([k, v]) => `${k}:${v};`)
        .join('')}}`
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    if (mode === 'tweaks') applyTweaks(tweaks)
  }, [tweaks, mode])

  const deselect = () => {
    const prev = selRef.current
    if (prev) {
      try {
        prev.style.outline = ''
        prev.style.outlineOffset = ''
        prev.removeAttribute('contenteditable')
      } catch {
        /* ignore */
      }
    }
    selRef.current = null
  }
  const selectElement = (el: HTMLElement) => {
    deselect()
    selRef.current = el
    try {
      el.style.outline = '2px solid #D97757'
      el.style.outlineOffset = '1px'
      el.setAttribute('contenteditable', 'true')
      if (!textOrigRef.current.has(el)) textOrigRef.current.set(el, el.textContent || '')
    } catch {
      /* ignore */
    }
    setSelProps(readValues(el))
  }

  // element-picking + edit wiring
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument
    if (!doc) return
    if (mode !== 'edit') {
      deselect()
      setSelProps(null)
      return
    }
    styleEditsRef.current = parseEdits(view?.content ?? '')

    const box = createHoverBox(doc)
    const onOver = (e: Event) => {
      const el = e.target as HTMLElement
      if (!el || el.nodeType !== 1 || el === box.node) return
      if (el === selRef.current) {
        box.hide()
        return
      }
      box.show(el)
    }

    const handler = (e: Event) => {
      const el = e.target as HTMLElement
      if (!el || el.nodeType !== 1) return
      // stop links/buttons from navigating or firing their handlers while editing
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      box.hide()
      selectElement(el)
    }
    const blockNav = (e: Event) => e.preventDefault()
    doc.addEventListener('mouseover', onOver, true)
    doc.addEventListener('mouseout', box.hide, true)
    doc.addEventListener('click', handler, true)
    doc.addEventListener('submit', blockNav, true)
    return () => {
      doc.removeEventListener('mouseover', onOver, true)
      doc.removeEventListener('mouseout', box.hide, true)
      doc.removeEventListener('click', handler, true)
      doc.removeEventListener('submit', blockNav, true)
      box.remove()
    }
  }, [mode, reload, view?.content])

  // Comments mode: click an element to pin a comment on it; each pin carries the
  // element's DOM path + key styles so the agent can find it in source precisely.
  useEffect(() => {
    if (mode !== 'comments') {
      setPins([])
      setDraftPin(null)
      return
    }
    const doc = iframeRef.current?.contentDocument
    const win = iframeRef.current?.contentWindow
    if (!doc || !win) return
    const box = createHoverBox(doc)
    const onOver = (e: Event) => {
      const el = e.target as HTMLElement
      if (el && el.nodeType === 1 && el !== box.node) box.show(el)
    }
    const onClick = (e: Event) => {
      const el = e.target as HTMLElement
      if (!el || el.nodeType !== 1) return
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      // A draft popover is already open — don't discard its (possibly typed) text by
      // re-pinning. The user must add or cancel it first.
      if (draftPinRef.current) return
      const me = e as MouseEvent
      const cs = win.getComputedStyle(el)
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50)
      setDraftPin({
        x: me.clientX,
        y: me.clientY,
        selector: selectorFor(el),
        label: `<${el.tagName.toLowerCase()}>${text ? `「${text}」` : ''}`,
        style: `font-size:${cs.fontSize}; color:${cs.color}; background:${cs.backgroundColor}`,
      })
    }
    const blockNav = (e: Event) => e.preventDefault()
    doc.addEventListener('mouseover', onOver, true)
    doc.addEventListener('mouseout', box.hide, true)
    doc.addEventListener('click', onClick, true)
    doc.addEventListener('submit', blockNav, true)
    return () => {
      doc.removeEventListener('mouseover', onOver, true)
      doc.removeEventListener('mouseout', box.hide, true)
      doc.removeEventListener('click', onClick, true)
      doc.removeEventListener('submit', blockNav, true)
      box.remove()
      // File switched or preview reloaded → the pinned DOM is gone; drop stale pins.
      setPins([])
      setDraftPin(null)
      setDraftText('')
    }
  }, [mode, reload, currentPath])

  // In view mode, make intra-project <a href> links navigate the preview in-place.
  useEffect(() => {
    if (mode !== 'view' || !isHtml) return
    const iframe = iframeRef.current
    if (!iframe) return
    const onClick = (e: Event) => {
      const a = (e.target as Element | null)?.closest?.('a')
      if (!a) return
      const href = a.getAttribute('href') || ''
      if (!href || href.startsWith('#')) return
      if (/^(https?:|mailto:|tel:)/i.test(href)) {
        e.preventDefault()
        window.open(href, '_blank')
        return
      }
      const target = resolvePageHref(project.files, href, currentPath)
      e.preventDefault()
      if (target && target !== currentPath) {
        setNavStack((s) => [...s, currentPath])
        setCurrentPath(target)
      }
    }
    let doc: Document | null = null
    const detach = () => {
      doc?.removeEventListener('click', onClick, true)
      doc = null
    }
    const attach = () => {
      detach()
      doc = iframe.contentDocument
      doc?.addEventListener('click', onClick, true)
    }
    iframe.addEventListener('load', attach)
    attach() // in case it's already loaded
    return () => {
      iframe.removeEventListener('load', attach)
      detach()
    }
  }, [mode, reload, currentPath, isHtml, project.files])

  const onIframeLoad = () => {
    if (mode === 'tweaks') applyTweaks(tweaks)
  }

  if (!view) {
    return (
      <div className="grid h-full place-items-center bg-paper text-[14px] text-ink-faint">{t('filetab.file_removed')}</div>
    )
  }

  if (isHtml && isDeckHtml(view.content)) return <DeckView project={project} path={path} />

  const toggleEdit = () => setMode((m) => (m === 'edit' ? 'view' : 'edit'))
  const toggleTweaks = () => setMode((m) => (m === 'tweaks' ? 'view' : 'tweaks'))
  const toggleMarkup = () => setMode((m) => (m === 'markup' ? 'view' : 'markup'))
  const toggleComments = () => setMode((m) => (m === 'comments' ? 'view' : 'comments'))

  const commitDraftPin = () => {
    if (!draftPin || !draftText.trim()) {
      setDraftPin(null)
      setDraftText('')
      return
    }
    setPins((p) => [...p, { ...draftPin, comment: draftText.trim() }])
    setDraftPin(null)
    setDraftText('')
  }

  // Each pinned comment becomes one actionable item with the element's DOM path,
  // so the agent can locate the exact element in source.
  const handleCommentsSend = () => {
    if (!pins.length) return
    const lines = pins.map((p, i) =>
      t('filetab.comment_line', { n: i + 1, label: p.label, comment: p.comment, selector: p.selector, style: p.style }),
    )
    const msg =
      t('filetab.comments_msg_head', { count: pins.length }) +
      lines.join('\n') +
      t('filetab.comments_msg_foot', { path: currentPath })
    onSendToChat(msg)
    setMode('view')
  }

  // Screenshot the marked-up design (preview + annotations) and send it, with the note,
  // to the chat so the agent can see exactly what was marked.
  const handleMarkupSend = async (shapes: Shape[], note: string) => {
    const text = note.trim() || t('filetab.markup_default_note')
    const msg = `${text}\n\n${t('filetab.current_file_paren', { path: currentPath })}`
    const doc = iframeRef.current?.contentDocument
    try {
      if (!doc) throw new Error('no preview')
      const h2c = (await import('html2canvas')).default
      const sx = doc.documentElement.scrollLeft || doc.body.scrollLeft || 0
      const sy = doc.documentElement.scrollTop || doc.body.scrollTop || 0
      const scale = Math.min(2, window.devicePixelRatio || 1)
      const canvas = await h2c(doc.body, { backgroundColor: '#ffffff', scale, useCORS: true, logging: false })
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.save()
        ctx.scale(scale, scale)
        paintShapes(ctx, shapes, sx, sy)
        ctx.restore()
      }
      const m = canvas.toDataURL('image/png').match(/^data:([^;]+);base64,(.*)$/)
      if (m) {
        onSendToChat(msg, [{ mimeType: m[1], data: m[2] }])
        setMode('view')
        return
      }
    } catch {
      /* fall through to a text-only message */
    }
    onSendToChat(shapes.length ? `${msg}\n${t('filetab.markup_shot_failed', { count: shapes.length })}` : msg)
    setMode('view')
  }

  const onEditChange = (key: string, value: string) => {
    const el = selRef.current
    if (!el) return
    const pairs = applyProp(el, key, value)
    if (pairs.length) {
      const sel = selectorFor(el)
      const rec = styleEditsRef.current.get(sel) ?? {}
      for (const [p, val] of pairs) rec[p] = val
      styleEditsRef.current.set(sel, rec)
    }
    setSelProps((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  const saveEdit = () => {
    const updates: Record<string, string> = {}
    const getC = (p: string) => updates[p] ?? project.files.find((f) => f.path === p)?.content ?? ''
    // text edits -> source replace
    for (const [el, orig] of textOrigRef.current) {
      const now = (el.textContent || '').replace(/\s+/g, ' ').trim()
      const o = orig.replace(/\s+/g, ' ').trim()
      if (now && o && now !== o) {
        for (const f of project.files) {
          const replaced = replaceFlexible(getC(f.path), o, now)
          if (replaced != null) {
            updates[f.path] = replaced
            break
          }
        }
      }
    }
    // style overrides -> <style id="__edits"> in active file
    if (styleEditsRef.current.size) {
      const blocks: string[] = []
      for (const [sel, props] of styleEditsRef.current) {
        const body = Object.entries(props)
          .map(([k, v]) => `${k}:${v} !important;`)
          .join('')
        blocks.push(`${sel}{${body}}`)
      }
      const css = `<style id="__edits">\n${blocks.join('\n')}\n</style>`
      let c = getC(currentPath)
      if (/<style id="__edits">[\s\S]*?<\/style>/.test(c)) c = c.replace(/<style id="__edits">[\s\S]*?<\/style>/, css)
      else if (c.includes('</head>')) c = c.replace('</head>', css + '\n</head>')
      else c = css + c
      updates[currentPath] = c
    }
    for (const [p, content] of Object.entries(updates)) writeFile(project.id, p, content)
    deselect()
    textOrigRef.current.clear()
    setSelProps(null)
    setMode('view')
    setReload((r) => r + 1)
  }
  const cancelEdit = () => {
    deselect()
    textOrigRef.current.clear()
    setSelProps(null)
    setMode('view')
    setReload((r) => r + 1)
  }

  const saveTweaks = () => {
    let out = view.content
    for (const v of vars) {
      const val = tweaks[v.name]
      if (val != null && val !== v.value) {
        out = out.replace(new RegExp(`(${escapeRe(v.name)}\\s*:\\s*)[^;]+`), `$1${val}`)
      }
    }
    writeFile(project.id, currentPath, out)
    setTweaks({})
  }

  const srcDoc = resolveHtml(view.content, project.files)
  const zoomStyle =
    mode === 'view' && isHtml
      ? {
          width: `${10000 / zoom}%`,
          height: `${10000 / zoom}%`,
          transform: `scale(${zoom / 100})`,
          transformOrigin: 'top left' as const,
        }
      : undefined

  return (
    <div className="flex h-full flex-col bg-paper">
      <div className="flex items-center gap-2 border-b border-line bg-panel px-4 py-2">
        {navStack.length > 0 && (
          <button
            onClick={() => {
              const prev = navStack[navStack.length - 1]
              setNavStack((s) => s.slice(0, -1))
              setCurrentPath(prev)
            }}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-muted hover:bg-sink"
            title={t('filetab.back')}
          >
            <ChevronLeft size={16} />
          </button>
        )}
        <button
          onClick={() => setReload((r) => r + 1)}
          className="grid h-8 w-8 place-items-center rounded-md text-ink-muted hover:bg-sink"
          title={t('filetab.reload')}
        >
          <RotateCw size={15} />
        </button>
        {isHtml && (
          <div className="ml-auto flex items-center gap-0.5">
            <ToolBtn
              icon={<PenLine size={15} />}
              label={t('filetab.markup')}
              onClick={toggleMarkup}
              active={mode === 'markup'}
              title={t('filetab.markup_tip')}
            />
            <ToolBtn icon={<Type size={15} />} label={t('common.edit')} onClick={toggleEdit} active={mode === 'edit'} title={t('filetab.edit_tip')} />
            <ToolBtn icon={<Plus size={15} />} label={t('filetab.tweaks')} onClick={toggleTweaks} active={mode === 'tweaks'} title={t('filetab.tweaks_tip')} />
            <ToolBtn
              icon={<MessageSquareText size={15} />}
              label={t('filetab.comments')}
              onClick={toggleComments}
              active={mode === 'comments'}
              title={t('filetab.comments_tip')}
            />
            <div className="relative ml-1">
              <button
                onClick={() => setZoomMenu((v) => !v)}
                className="flex items-center gap-0.5 rounded-md px-2 py-1.5 text-[13px] tabular-nums text-ink-soft hover:bg-sink"
                title={t('filetab.zoom')}
              >
                {zoom}%
              </button>
              {zoomMenu && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setZoomMenu(false)} />
                  <div className="thin-scrollbar absolute right-0 top-full z-30 mt-1 max-h-72 w-24 overflow-y-auto rounded-xl border border-line bg-white p-1 shadow-pop">
                    {ZOOMS.map((z) => (
                      <button
                        key={z}
                        onClick={() => {
                          setZoom(z)
                          setZoomMenu(false)
                        }}
                        className={
                          'block w-full rounded-lg px-3 py-1.5 text-left text-[13px] tabular-nums hover:bg-panel ' +
                          (zoom === z ? 'font-medium text-ink' : 'text-ink-soft')
                        }
                      >
                        {z}%
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Edit panel docks over the far-left chat column */}
      {mode === 'edit' && isHtml && (
        <div
          className="fixed left-0 z-40 border-r border-line bg-panel shadow-pop"
          style={{ top: 56, bottom: 0, width: chatWidth }}
        >
          <EditPanel values={selProps} onChange={onEditChange} onClose={() => setMode('view')} />
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {isHtml ? (
            <div className="h-full w-full" style={zoomStyle}>
              <iframe
                ref={iframeRef}
                key={view.path + view.updatedAt + reload}
                title={view.path}
                srcDoc={srcDoc}
                onLoad={onIframeLoad}
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                className="h-full w-full border-0 bg-white"
              />
            </div>
          ) : isSvg ? (
            <div
              className="grid h-full place-items-center overflow-auto bg-white p-8"
              dangerouslySetInnerHTML={{ __html: view.content }}
            />
          ) : isImage ? (
            <div className="grid h-full place-items-center overflow-auto bg-[#FAF9F5] p-8">
              <img src={view.content} alt={view.path} className="max-h-full max-w-full object-contain" />
            </div>
          ) : (
            <pre className="thin-scrollbar h-full overflow-auto bg-[#1F1E1B] p-5 font-mono text-[12.5px] leading-relaxed text-[#EDEAE0]">
              <code>{view.content || '(empty file)'}</code>
            </pre>
          )}

          {mode === 'edit' && (
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 border-t border-line bg-panel px-4 py-2.5">
              <span className="text-[12.5px] text-ink-muted">{t('filetab.edit_mode_hint')}</span>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={cancelEdit} className="rounded-lg px-3 py-1.5 text-[13px] text-ink-muted hover:bg-sink">
                  {t('common.cancel')}
                </button>
                <button
                  onClick={saveEdit}
                  className="flex items-center gap-1.5 rounded-lg bg-coral px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-coral-dark"
                >
                  <Check size={14} /> {t('common.save')}
                </button>
              </div>
            </div>
          )}

          {mode === 'markup' && isHtml && <MarkupLayer onSend={handleMarkupSend} onClose={() => setMode('view')} />}

          {mode === 'comments' && isHtml && (
            <div className="pointer-events-none absolute inset-0 z-30">
              {pins.map((p, i) => (
                <span
                  key={i}
                  className="absolute grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-coral text-[12px] font-semibold text-white shadow-pop"
                  style={{ left: p.x, top: p.y }}
                  title={`${p.label} ${p.comment}`}
                >
                  {i + 1}
                </span>
              ))}

              {draftPin && (
                <div
                  className="pointer-events-auto absolute z-40 w-[280px] rounded-xl border border-line bg-white p-3 shadow-pop"
                  style={{ left: Math.max(8, Math.min(draftPin.x - 140, 9999)), top: draftPin.y + 10 }}
                >
                  <div className="mb-1.5 truncate text-[12px] text-ink-muted">{draftPin.label}</div>
                  <textarea
                    autoFocus
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault()
                        commitDraftPin()
                      }
                      if (e.key === 'Escape') {
                        setDraftPin(null)
                        setDraftText('')
                      }
                    }}
                    rows={2}
                    placeholder={t('filetab.pin_placeholder')}
                    className="w-full resize-none rounded-lg border border-line bg-panel px-2.5 py-2 text-[13px] text-ink placeholder:text-ink-faint focus:border-coral-muted focus:outline-none"
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      onClick={() => {
                        setDraftPin(null)
                        setDraftText('')
                      }}
                      className="rounded-md px-2.5 py-1.5 text-[12.5px] text-ink-muted hover:bg-sink"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      onClick={commitDraftPin}
                      disabled={!draftText.trim()}
                      className="rounded-md bg-coral px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-coral-dark disabled:bg-coral-muted"
                    >
                      {t('filetab.add')}
                    </button>
                  </div>
                </div>
              )}

              <div className="pointer-events-auto absolute inset-x-0 bottom-0 flex items-center gap-3 border-t border-line bg-panel px-4 py-2.5">
                <span className="text-[12.5px] text-ink-muted">
                  {t('filetab.comments_mode_hint')}{pins.length > 0 ? t('filetab.comments_added', { count: pins.length }) : ''}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => setMode('view')}
                    className="rounded-lg px-3 py-1.5 text-[13px] text-ink-muted hover:bg-sink"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleCommentsSend}
                    disabled={pins.length === 0}
                    className="flex items-center gap-1.5 rounded-lg bg-coral px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-coral-dark disabled:bg-coral-muted"
                  >
                    <MessageSquareText size={14} /> {t('filetab.send_to_claude', { count: pins.length })}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {mode === 'tweaks' && (
          <div className="thin-scrollbar w-[280px] shrink-0 overflow-y-auto border-l border-line bg-panel">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="text-[13px] font-semibold text-ink">{t('filetab.tweaks')}</span>
              <button onClick={() => setMode('view')} className="grid h-7 w-7 place-items-center rounded-md text-ink-muted hover:bg-sink">
                <X size={15} />
              </button>
            </div>
            {vars.length === 0 ? (
              <p className="px-4 py-5 text-[12.5px] leading-relaxed text-ink-muted">
                {t('filetab.no_vars_before')}
                <span className="font-mono">:root</span>
                {t('filetab.no_vars_after')}
              </p>
            ) : (
              <>
                <div className="space-y-3.5 px-4 py-4">
                  {vars.map((vrow) => {
                    const val = tweaks[vrow.name] ?? vrow.value
                    const isHex = /^#[0-9a-fA-F]{6}$/.test(val.trim())
                    return (
                      <label key={vrow.name} className="block">
                        <div className="mb-1 truncate font-mono text-[11.5px] text-ink-muted">{vrow.name}</div>
                        <div className="flex items-center gap-2">
                          {isHex && (
                            <input
                              type="color"
                              value={val}
                              onChange={(e) => setTweaks((t) => ({ ...t, [vrow.name]: e.target.value }))}
                              className="h-8 w-9 shrink-0 cursor-pointer rounded border border-line bg-white p-0.5"
                            />
                          )}
                          <input
                            value={val}
                            onChange={(e) => setTweaks((t) => ({ ...t, [vrow.name]: e.target.value }))}
                            className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 font-mono text-[12px] text-ink focus:border-coral-muted focus:outline-none"
                          />
                        </div>
                      </label>
                    )
                  })}
                </div>
                <div className="sticky bottom-0 flex items-center gap-2 border-t border-line bg-panel px-4 py-3">
                  <button
                    onClick={saveTweaks}
                    disabled={Object.keys(tweaks).length === 0}
                    className="flex-1 rounded-lg bg-coral py-2 text-[13px] font-medium text-white hover:bg-coral-dark disabled:bg-coral-muted"
                  >
                    {t('filetab.save_to_file')}
                  </button>
                  <button
                    onClick={() => setTweaks({})}
                    className="rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-ink-soft hover:bg-sink"
                  >
                    {t('filetab.reset')}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
