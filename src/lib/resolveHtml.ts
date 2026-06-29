import type { ProjectFile } from './types'

function findFile(files: ProjectFile[], ref: string): ProjectFile | undefined {
  const clean = ref.replace(/^\.?\//, '').split(/[?#]/)[0]
  const base = clean.split('/').pop()
  return (
    files.find((f) => f.path === ref) ||
    files.find((f) => f.path === clean) ||
    files.find((f) => f.path.endsWith('/' + clean)) ||
    files.find((f) => f.path.split('/').pop() === base)
  )
}

/** Resolve an href (relative to fromPath's dir, or absolute) against the project. */
export function resolvePageHref(files: ProjectFile[], href: string, fromPath: string): string | null {
  const clean = href.split(/[?#]/)[0]
  if (!clean) return null
  let segs: string[]
  if (clean.startsWith('/')) {
    segs = clean.replace(/^\/+/, '').split('/')
  } else {
    const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')).split('/') : []
    segs = dir.concat(clean.split('/'))
  }
  const out: string[] = []
  for (const s of segs) {
    if (s === '' || s === '.') continue
    if (s === '..') out.pop()
    else out.push(s)
  }
  const resolved = out.join('/')
  if (!resolved) return null
  const exact = files.find((f) => f.path === resolved)
  if (exact) return exact.path
  const base = resolved.split('/').pop()
  return files.find((f) => f.path.split('/').pop() === base)?.path ?? null
}

/**
 * Inline same-project references so a multi-file design renders in a sandboxed
 * iframe (project files aren't HTTP-served). Handles <script src>, stylesheet
 * <link href>, and <img src> pointing at project files.
 */
export function resolveHtml(html: string, files: ProjectFile[]): string {
  let out = html

  // <script ... src="x.jsx" ...></script>  ->  inline (preserving type=text/babel etc.)
  out = out.replace(/<script\b([^>]*?)\ssrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (m, pre, src, post) => {
    const f = findFile(files, src)
    if (!f) return m
    return `<script${pre}${post}>\n${f.content}\n</script>`
  })

  // <link rel="stylesheet" href="x.css">  ->  <style>...</style>
  out = out.replace(/<link\b([^>]*)>/gi, (m, attrs) => {
    if (!/stylesheet/i.test(attrs)) return m
    const hrefM = attrs.match(/\shref=["']([^"']+)["']/i)
    if (!hrefM) return m
    const f = findFile(files, hrefM[1])
    return f ? `<style>\n${f.content}\n</style>` : m
  })

  // <img src="x.svg|png|…">  ->  inline the project file (svg as utf8, dropped raster
  // assets are stored as data URLs, so use them directly)
  out = out.replace(/(<img\b[^>]*?\ssrc=)["']([^"']+)["']/gi, (m, pre, src) => {
    const f = findFile(files, src)
    if (!f) return m
    const ext = (f.path.split('.').pop() || '').toLowerCase()
    if (ext === 'svg' && !f.content.startsWith('data:'))
      return `${pre}"data:image/svg+xml;utf8,${encodeURIComponent(f.content)}"`
    if (f.content.startsWith('data:')) return `${pre}"${f.content}"`
    return m
  })

  return out
}
