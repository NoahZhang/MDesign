import { useCallback, useEffect, useRef, useState } from 'react'
import { resolvePageHref } from './resolveHtml'
import type { Project } from './types'

// In-place navigation for a preview iframe (Present overlay, file preview card). Mirrors
// FileTabView's view-mode interceptor: a click on an intra-project link swaps the preview
// to the linked page instead of letting the iframe navigate (a srcdoc iframe resolves a
// relative href against the parent /p/<id> url, which would blow the whole app away).
// External links open in a new tab (the desktop app routes window.open to the browser).
//
// `iframeRef` is a callback ref so the click interceptor attaches reliably even when the
// iframe is mounted later (e.g. the Present overlay opening) or remounted on page swap.
export function usePreviewNav(project: Project, initialPath: string) {
  const [path, setPath] = useState(initialPath)
  const [stack, setStack] = useState<string[]>([])

  // Keep latest values for the click handler, which is attached once per iframe element.
  const pathRef = useRef(path)
  const filesRef = useRef(project.files)
  pathRef.current = path
  filesRef.current = project.files

  useEffect(() => {
    setPath(initialPath)
    setStack([])
  }, [initialPath])

  const detachRef = useRef<(() => void) | null>(null)

  const iframeRef = useCallback((iframe: HTMLIFrameElement | null) => {
    detachRef.current?.()
    detachRef.current = null
    if (!iframe) return

    let doc: Document | null = null
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
      e.preventDefault()
      const cur = pathRef.current
      const target = resolvePageHref(filesRef.current, href, cur)
      if (target && target !== cur) {
        setStack((s) => [...s, cur])
        setPath(target)
      }
    }
    const attach = () => {
      doc?.removeEventListener('click', onClick, true)
      doc = iframe.contentDocument
      doc?.addEventListener('click', onClick, true)
    }
    iframe.addEventListener('load', attach)
    attach() // in case it is already loaded
    detachRef.current = () => {
      iframe.removeEventListener('load', attach)
      doc?.removeEventListener('click', onClick, true)
    }
  }, [])

  const back =
    stack.length > 0
      ? () => {
          const prev = stack[stack.length - 1]
          setStack((s) => s.slice(0, -1))
          setPath(prev)
        }
      : null

  return { iframeRef, path, back }
}
