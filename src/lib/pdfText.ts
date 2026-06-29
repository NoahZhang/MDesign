// Client-side PDF text extraction (pdf.js, lazy-loaded). The extracted text travels
// to the model as plain text — model-agnostic (the Ark gateway has no PDF block
// support), works offline, and renders in chat as a compact attachment chip.

const MAX_CHARS = 40_000 // keep a big PDF from blowing the context

export interface PdfDoc {
  name: string
  pages: number
  text: string
}

function clampDoc(name: string, pages: number, text: string): PdfDoc {
  let t = text.trim()
  if (t.length > MAX_CHARS) t = t.slice(0, MAX_CHARS) + '\n（内容过长，已截断）'
  return { name, pages, text: t }
}

export async function extractPdfText(file: File): Promise<PdfDoc> {
  const data = await file.arrayBuffer()

  // Desktop app: native PDFKit via the local server (immune to webview JS quirks,
  // Apple-grade CJK extraction). The web build has no /__pdf and falls through.
  try {
    const res = await fetch('/__pdf', { method: 'POST', body: data })
    if (res.ok) {
      const j = (await res.json()) as { text?: string; pages?: number }
      if (typeof j.text === 'string') return clampDoc(file.name, j.pages ?? 0, j.text)
    } else if (res.status === 422) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (j.error === 'encrypted') throw new Error('PDF 已加密，无法读取')
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('加密')) throw e
    /* no native endpoint (web version) or transient failure — fall back to pdf.js */
  }

  // Browser fallback: pdfjs-dist pinned to 3.11.174 legacy (classic worker, old
  // syntax — v4+/v6 builds break in some webviews).
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf')
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.js?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const task = pdfjs.getDocument({ data, isEvalSupported: false })
  const doc = await task.promise
  const parts: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const tc = await page.getTextContent()
    const pageText = (tc.items as { str?: string }[])
      .map((it) => it.str ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    parts.push(`— 第 ${i} 页 —\n${pageText}`)
    if (parts.join('\n\n').length > MAX_CHARS) break
  }
  const pages = doc.numPages
  try {
    await task.destroy()
  } catch {
    /* ignore */
  }
  return clampDoc(file.name, pages, parts.join('\n\n'))
}

/** Marker prefix for a PDF text block inside a user message — the chat UI renders
 *  these blocks as attachment chips instead of dumping the full text. */
export const PDF_MARK = '[[PDF附件:'

export function pdfBlockText(d: PdfDoc): string {
  return `${PDF_MARK} ${d.name} · ${d.pages}页]]\n以下是该 PDF 的文本内容，作为参考资料：\n${d.text}`
}

/** Parse the chip label out of a marked block ('' if not a PDF block). */
export function pdfBlockLabel(text: string): string {
  if (!text.startsWith(PDF_MARK)) return ''
  const end = text.indexOf(']]')
  return end > 0 ? text.slice(PDF_MARK.length, end).trim() : 'PDF'
}
