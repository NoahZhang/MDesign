import { resolveHtml } from './resolveHtml'
import type { ProjectFile } from './types'

// Shared helpers for treating an HTML file as a slide deck: each slide is an element with
// class `slide` (the agent writes `<section class="slide">`), authored at 1280×720. Used by
// the in-app deck viewer (DeckView) and the PPTX exporter (htmlToPptx).

export const SLIDE_W = 1280
export const SLIDE_H = 720

/** A deck is an HTML file that contains at least one `.slide` element. */
export function isDeckHtml(content: string): boolean {
  return /<(section|div|article|main)\b[^>]*class\s*=\s*["'][^"']*\bslide\b/i.test(content)
}

/** Split a deck's HTML into its <head> markup and each slide's outerHTML. */
export function parseDeckHtml(html: string): { head: string; slides: string[] } {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const els = Array.from(doc.querySelectorAll('.slide, [data-slide]'))
  const slides = els.length
    ? els.map((e) => (e as HTMLElement).outerHTML)
    : [`<section class="slide">${doc.body.innerHTML}</section>`]
  return { head: doc.head.innerHTML, slides }
}

// A deck viewer hides every slide but the active one; when we render a slide in isolation we
// must force it visible at native 1280×720, overriding the deck's own display/transform rules.
export const SLIDE_FORCE =
  'display:block!important;visibility:visible!important;opacity:1!important;' +
  'position:relative!important;left:0!important;top:0!important;right:auto!important;bottom:auto!important;' +
  'margin:0!important;transform:none!important;width:1280px!important;height:720px!important;overflow:hidden!important'

/** Build a self-contained single-slide document (head styles + one forced-visible slide),
 *  with project assets inlined, suitable for an iframe srcDoc or offscreen capture. */
export function buildSlideDoc(head: string, slideHtml: string, files: ProjectFile[]): string {
  const doc =
    `<!doctype html><html><head>${head}` +
    `<style>html,body{margin:0;padding:0}*{box-sizing:border-box}.slide{${SLIDE_FORCE}}</style>` +
    `</head><body>${slideHtml}</body></html>`
  return resolveHtml(doc, files)
}
