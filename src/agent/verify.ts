import { resolveHtml } from '../lib/resolveHtml'
import type { ProjectFile } from '../lib/types'

// Post-generation self-check (the "verifier"): render the produced HTML in a hidden
// iframe and run deterministic checks — runtime/compile errors, unresolved project
// references, broken images, horizontal overflow, blank output. The findings go back
// to the agent as the `done` tool's result so it can fix them and finish properly.
// Text-only by design: works with any model, vision or not.

const VIEW_W = 1280
const VIEW_H = 800

// Collector injected before any other script (incl. Babel) so it sees every error.
const COLLECTOR =
  '<script>(function(){var p=window.__mdProblems=[];' +
  'window.addEventListener("error",function(e){' +
  'var t=e.target;' +
  'if(t&&t!==window&&t.tagName){p.push("资源加载失败: <"+t.tagName.toLowerCase()+"> "+String(t.src||t.href||"").slice(0,120));return;}' +
  'p.push("JS error: "+(e.message||e.type)+(e.lineno?" (line "+e.lineno+")":""));},true);' +
  'window.addEventListener("unhandledrejection",function(e){p.push("Unhandled promise rejection: "+String(e.reason).slice(0,200));});' +
  'var ce=console.error;console.error=function(){try{p.push("console.error: "+Array.prototype.map.call(arguments,function(a){return String(a)}).join(" ").slice(0,300));}catch(_){}return ce.apply(console,arguments);};' +
  '})();</script>'

function injectCollector(html: string): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + COLLECTOR)
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + COLLECTOR)
  return COLLECTOR + html
}

function renderHidden(docHtml: string): Promise<HTMLIFrameElement> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe')
    iframe.style.cssText = `position:fixed;left:-99999px;top:0;width:${VIEW_W}px;height:${VIEW_H}px;border:0;`
    iframe.sandbox.add('allow-scripts', 'allow-same-origin')
    iframe.srcdoc = docHtml
    iframe.onload = () => resolve(iframe)
    document.body.appendChild(iframe)
  })
}

const dedupe = (arr: string[]) => Array.from(new Set(arr))

export interface VerifyResult {
  problems: string[]
  /** JPEG data URL of the rendered page — captured only when the checks pass. */
  screenshot?: string
}

/** Render `path`: deterministic checks + (when clean) a screenshot for visual self-review. */
export async function verifyDesign(path: string, files: ProjectFile[]): Promise<VerifyResult> {
  const file = files.find((f) => f.path === path)
  if (!file || !/\.html?$/i.test(path)) return { problems: [] }

  const resolved = resolveHtml(file.content, files)
  const usesBabel = /text\/babel|babel\.min\.js|@babel\/standalone/i.test(resolved)
  const iframe = await renderHidden(injectCollector(resolved))
  try {
    // let scripts run; Babel + React need extra time to transform and mount
    await new Promise((r) => setTimeout(r, usesBabel ? 2200 : 700))

    const doc = iframe.contentDocument
    const win = iframe.contentWindow as (Window & { __mdProblems?: string[] }) | null
    if (!doc || !win) return { problems: [] }
    const problems: string[] = []

    // 1. runtime / compile errors captured by the collector
    for (const e of (win.__mdProblems ?? []).slice(0, 4)) problems.push(e)

    // 2. project references that didn't resolve (file missing → won't render for the user)
    const unresolved: string[] = []
    doc.querySelectorAll('script[src], link[href][rel="stylesheet"], img[src]').forEach((el) => {
      const ref = el.getAttribute('src') || el.getAttribute('href') || ''
      if (ref && !/^(https?:|data:|\/\/|#)/i.test(ref)) unresolved.push(ref)
    })
    if (unresolved.length) problems.push(`引用了项目里不存在的文件: ${dedupe(unresolved).slice(0, 5).join(', ')}`)

    // 3. broken images
    const broken: string[] = []
    doc.querySelectorAll('img').forEach((img) => {
      if (img.complete && img.naturalWidth === 0) broken.push(img.getAttribute('src')?.slice(0, 80) || '(img)')
    })
    if (broken.length) problems.push(`图片加载失败: ${dedupe(broken).slice(0, 4).join(', ')}`)

    // 4. horizontal overflow at a desktop viewport
    const sw = doc.documentElement.scrollWidth
    if (sw > VIEW_W + 8) problems.push(`页面在 ${VIEW_W}px 视口下出现横向溢出（内容宽 ${sw}px）——检查固定宽度元素。`)

    // 5. blank output (nothing visible rendered)
    const body = doc.body
    const hasVisual = !!body && (body.innerText.trim().length > 0 || body.querySelector('img,svg,canvas,video,iframe') != null)
    if (!hasVisual) problems.push('页面渲染后是空白的——没有任何可见内容（脚本可能没有挂载成功）。')

    const finalProblems = dedupe(problems).slice(0, 6)

    // Clean → capture a small screenshot so a vision-capable model can self-review the
    // visual result. Kept compact (0.6×, JPEG) since it lives on in the conversation.
    let screenshot: string | undefined
    if (finalProblems.length === 0) {
      try {
        const h2c = (await import('html2canvas')).default
        const canvas = await h2c(doc.body, { backgroundColor: '#ffffff', scale: 0.6, useCORS: true, logging: false })
        const url = canvas.toDataURL('image/jpeg', 0.7)
        if (url.length > 200) screenshot = url
      } catch {
        /* screenshot is best-effort */
      }
    }

    return { problems: finalProblems, screenshot }
  } finally {
    iframe.remove()
  }
}
