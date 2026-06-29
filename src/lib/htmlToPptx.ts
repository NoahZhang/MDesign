import { download, safeName } from './exportProject'
import { buildSlideDoc, parseDeckHtml, SLIDE_FORCE } from './deckHtml'
import type { ProjectFile } from './types'

// Convert an HTML deck (a webpage whose slides are `<section class="slide">` blocks, each a
// 1280×720 canvas) into a NATIVE, editable PowerPoint via PptxGenJS. Each slide is rendered
// offscreen at 1280×720; we read every element's final geometry + computed style and emit real
// PPT text boxes / shapes / images. 1in = 96px, so a 1280×720 slide maps to 13.333×7.5in.
//
// Conversion is approximate: text, solid backgrounds/borders/radius, images and slide
// backgrounds convert well; gradients (background-image), box-shadow and ::before/::after
// content are dropped — only a solid `background-color` becomes a fill.

const PX = 96
const inch = (px: number) => +(px / PX).toFixed(3)
const pt = (px: number) => +(px * 0.75).toFixed(1) // 96dpi px -> 72dpi pt

function color(c: string): { hex: string; alpha: number } | null {
  const m = (c || '').match(/rgba?\(([^)]+)\)/i)
  if (!m) return null
  const parts = m[1].split(',').map((s) => s.trim())
  const a = parts[3] != null ? parseFloat(parts[3]) : 1
  const h = (n: string) => Math.max(0, Math.min(255, parseInt(n) || 0)).toString(16).padStart(2, '0')
  return { hex: (h(parts[0]) + h(parts[1]) + h(parts[2])).toUpperCase(), alpha: a }
}

function firstFont(ff: string): string | undefined {
  const f = (ff || '').split(',')[0].replace(/["']/g, '').trim()
  return f && !/^(-apple-system|system-ui|ui-|sans-serif|serif|monospace)$/i.test(f) ? f : undefined
}

function directText(el: Element): string {
  let t = ''
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) t += n.textContent
  })
  return t.replace(/\s+/g, ' ').trim()
}

const BLOCKY = new Set(['block', 'flex', 'grid', 'table', 'list-item', 'flow-root'])
function blockish(el: Element, win: Window): boolean {
  if (el.tagName === 'IMG' || el.tagName === 'BR') return true
  const cs = win.getComputedStyle(el)
  if (BLOCKY.has(cs.display)) return true
  const bg = color(cs.backgroundColor)
  return (!!bg && bg.alpha > 0.02) || parseFloat(cs.borderTopWidth) > 0.5
}

function walk(el: Element, slide: any, origin: DOMRect, win: Window, ShapeType: any) {
  const cs = win.getComputedStyle(el)
  if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) {
    for (const c of Array.from(el.children)) walk(c, slide, origin, win, ShapeType)
    return
  }
  const box = { x: inch(r.left - origin.left), y: inch(r.top - origin.top), w: inch(r.width), h: inch(r.height) }

  if (el.tagName === 'IMG') {
    const src = (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src
    if (src && (src.startsWith('data:') || /^https?:/i.test(src))) {
      try {
        slide.addImage({ ...box, ...(src.startsWith('data:') ? { data: src } : { path: src }), sizing: { type: 'contain', w: box.w, h: box.h } })
      } catch {
        /* ignore unfetchable image */
      }
    }
    return
  }

  const bg = color(cs.backgroundColor)
  const bw = parseFloat(cs.borderTopWidth) || 0
  const bc = color(cs.borderTopColor)
  const radius = parseFloat(cs.borderTopLeftRadius) || 0
  if ((bg && bg.alpha > 0.02) || bw > 0.5) {
    slide.addShape(ShapeType.rect, {
      ...box,
      fill: bg && bg.alpha > 0.02 ? { color: bg.hex, transparency: Math.round((1 - bg.alpha) * 100) } : { type: 'none' },
      line: bw > 0.5 && bc ? { color: bc.hex, width: pt(bw) } : { type: 'none' },
      rectRadius: radius ? Math.min(inch(radius), box.h / 2) : undefined,
    })
  }

  const own = directText(el)
  const hasBlockChild = Array.from(el.children).some((c) => blockish(c, win))
  if (own && !hasBlockChild) {
    const col = color(cs.color)
    const align = cs.textAlign === 'center' || cs.textAlign === 'right' ? cs.textAlign : 'left'
    slide.addText((el.textContent || own).replace(/\s+/g, ' ').trim(), {
      ...box,
      margin: 0,
      fontSize: pt(parseFloat(cs.fontSize) || 18),
      bold: (parseInt(cs.fontWeight) || 400) >= 600,
      italic: cs.fontStyle === 'italic',
      color: col ? col.hex : '000000',
      align,
      valign: 'top',
      fontFace: firstFont(cs.fontFamily),
      lineSpacingMultiple: 1,
    })
    return
  }

  for (const c of Array.from(el.children)) walk(c, slide, origin, win, ShapeType)
}

function renderOffscreen(docHtml: string): Promise<HTMLIFrameElement> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;left:-99999px;top:0;width:1280px;height:720px;border:0;'
    // Set srcdoc BEFORE connecting so the single load event is for our content
    // (a detached iframe doesn't load until appended, avoiding an about:blank onload).
    iframe.srcdoc = docHtml
    iframe.onload = () => resolve(iframe)
    document.body.appendChild(iframe)
  })
}

/** Export the slides found in an HTML deck to a native editable .pptx and download it. */
export async function exportHtmlToPptx(html: string, name: string, files: ProjectFile[]): Promise<void> {
  const PptxGenJS = (await import('pptxgenjs')).default
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'MD', width: 13.333, height: 7.5 })
  pptx.layout = 'MD'

  const { head, slides } = parseDeckHtml(html)

  for (const sHtml of slides) {
    const iframe = await renderOffscreen(buildSlideDoc(head, sHtml, files))
    try {
      const cdoc = iframe.contentDocument!
      const win = iframe.contentWindow!
      try {
        await (cdoc as Document & { fonts?: FontFaceSet }).fonts?.ready
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 40))
      const slideEl = (cdoc.querySelector('.slide') as HTMLElement) || cdoc.body
      // Inline !important beats any stylesheet rule, including a more-specific !important one.
      slideEl.style.cssText += ';' + SLIDE_FORCE
      void slideEl.offsetHeight // force reflow before measuring
      const origin = slideEl.getBoundingClientRect()
      const slide = pptx.addSlide()
      const sbg = color(win.getComputedStyle(slideEl).backgroundColor)
      if (sbg && sbg.alpha > 0.02) slide.background = { color: sbg.hex }
      for (const c of Array.from(slideEl.children)) walk(c, slide, origin, win, pptx.ShapeType)
    } finally {
      iframe.remove()
    }
  }

  const blob = (await pptx.write({ outputType: 'blob' })) as Blob
  download(blob, `${safeName(name)}.pptx`)
}
