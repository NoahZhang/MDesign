import { resolveHtml } from './resolveHtml'
import { alertDialog } from './dialog'
import type { Project } from './types'

export function safeName(s: string) {
  return (s.trim().replace(/[^\w一-龥.-]+/g, '-').replace(/^-+|-+$/g, '') || 'project').slice(0, 60)
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** Zip every file in the project and download it. */
export async function exportZip(project: Project) {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  for (const f of project.files) zip.file(f.path, f.content)
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  download(blob, `${safeName(project.name)}.zip`)
}

/** Inline the main HTML's project references into a single self-contained file. */
export function exportStandalone(project: Project) {
  const main =
    project.files.find((f) => f.path.toLowerCase() === 'index.html') ||
    project.files.find((f) => /\.html?$/i.test(f.path))
  if (!main) {
    alertDialog('该项目没有可导出的 HTML 文件。')
    return
  }
  const html = resolveHtml(main.content, project.files)
  download(new Blob([html], { type: 'text/html' }), `${safeName(project.name)}.html`)
}
