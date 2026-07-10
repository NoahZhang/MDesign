import { useEffect, useState } from 'react'
import { ChevronLeft, Code2, Copy, Check, ExternalLink, Eye } from 'lucide-react'
import { relTime } from '../../lib/format'
import { fileKind } from '../../lib/types'
import { useT } from '../../lib/i18n'
import { resolveHtml } from '../../lib/resolveHtml'
import { isDeckHtml } from '../../lib/deckHtml'
import { usePreviewNav } from '../../lib/usePreviewNav'
import DeckView from './DeckView'
import type { Project } from '../../lib/types'

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const TYPE_LABEL_KEY: Record<string, string> = {
  page: 'preview.type_page',
  component: 'preview.type_component',
  asset: 'preview.type_asset',
  doc: 'preview.type_doc',
}

export default function FilePreview({ project, selected }: { project: Project; selected: string | null }) {
  const t = useT()
  const file = selected ? project.files.find((f) => f.path === selected) : undefined
  const kind = file ? fileKind(file.path) : 'doc'
  const [mode, setMode] = useState<'preview' | 'code'>('preview')
  const [copied, setCopied] = useState(false)
  const nav = usePreviewNav(project, selected ?? '')
  const viewFile = project.files.find((f) => f.path === nav.path) ?? file

  useEffect(() => {
    setMode(kind === 'page' ? 'preview' : 'code')
  }, [selected, kind])

  if (!file) {
    return (
      <div className="grid h-full place-items-center bg-paper">
        <p className="text-[14px] text-ink-faint">{t('preview.select_file')}</p>
      </div>
    )
  }

  if (kind === 'page' && isDeckHtml(file.content)) return <DeckView project={project} path={file.path} />

  const isHtml = kind === 'page'
  const isImage = file.content.startsWith('data:') && file.contentType.startsWith('image/')
  const isSvg = file.path.toLowerCase().endsWith('.svg') && !isImage
  const ext = (file.path.split('.').pop() ?? '').toUpperCase()
  const size = fmtSize(new TextEncoder().encode(file.content).length)

  const openTab = () => {
    if (isImage) {
      window.open(file.content, '_blank')
      return
    }
    const out = isHtml ? resolveHtml(file.content, project.files) : file.content
    const blob = new Blob([out], { type: isHtml ? 'text/html' : file.contentType })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 8000)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(file.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* ignore */
    }
  }

  const showCode = !isHtml || mode === 'code'

  return (
    <div className="thin-scrollbar h-full overflow-auto bg-paper">
      <div className="grid min-h-full place-items-center px-8 py-10">
        <div className="w-full max-w-[720px]">
          {/* preview card */}
          <div className="aspect-[16/10] overflow-hidden rounded-2xl border border-line bg-white shadow-raised">
            {isHtml && mode === 'preview' ? (
              <div className="relative h-full w-full">
                {nav.back && (
                  <button
                    onClick={nav.back}
                    className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded-md border border-line bg-white/90 px-2 py-1 text-[12px] font-medium text-ink shadow-card backdrop-blur hover:bg-white"
                    title={t('preview.back')}
                  >
                    <ChevronLeft size={13} /> {t('preview.back')}
                  </button>
                )}
                <iframe
                  ref={nav.iframeRef}
                  key={(viewFile ?? file).path + (viewFile ?? file).updatedAt}
                  title={(viewFile ?? file).path}
                  srcDoc={resolveHtml((viewFile ?? file).content, project.files)}
                  sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                  className="h-full w-full border-0 bg-white"
                />
              </div>
            ) : isSvg && mode === 'preview' ? (
              <div
                className="grid h-full place-items-center overflow-auto bg-white p-8"
                dangerouslySetInnerHTML={{ __html: file.content }}
              />
            ) : isImage ? (
              <div className="grid h-full place-items-center bg-[#FAF9F5] p-6">
                <img src={file.content} alt={file.path} className="max-h-full max-w-full object-contain" />
              </div>
            ) : (
              <pre className="thin-scrollbar h-full overflow-auto bg-[#1F1E1B] p-5 font-mono text-[12px] leading-relaxed text-[#EDEAE0]">
                <code>{file.content || t('preview.empty_file')}</code>
              </pre>
            )}
          </div>

          {/* actions */}
          <div className="mt-5 flex items-center justify-center gap-2">
            <button
              onClick={openTab}
              className="flex items-center gap-2 rounded-lg border border-line bg-white px-4 py-2 text-[13.5px] font-medium text-ink shadow-card transition-colors hover:bg-panel"
            >
              <ExternalLink size={15} />
              {t('preview.open')}
            </button>
            {isHtml && (
              <div className="flex rounded-lg border border-line bg-white p-0.5">
                <button
                  onClick={() => setMode('preview')}
                  className={
                    'flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12.5px] ' +
                    (mode === 'preview' ? 'bg-sink font-medium text-ink' : 'text-ink-muted hover:text-ink')
                  }
                >
                  <Eye size={13} /> {t('preview.preview')}
                </button>
                <button
                  onClick={() => setMode('code')}
                  className={
                    'flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12.5px] ' +
                    (showCode ? 'bg-sink font-medium text-ink' : 'text-ink-muted hover:text-ink')
                  }
                >
                  <Code2 size={13} /> {t('preview.code')}
                </button>
              </div>
            )}
            <button
              onClick={copy}
              className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-white text-ink-muted transition-colors hover:bg-panel"
              title={t('preview.copy')}
            >
              {copied ? <Check size={15} className="text-coral-dark" /> : <Copy size={15} />}
            </button>
          </div>

          {/* metadata */}
          <div className="mt-5 text-center">
            <div className="text-[16px] font-semibold text-ink">{file.path.split('/').pop()}</div>
            <div className="mt-0.5 text-[13px] text-ink-muted">{t(TYPE_LABEL_KEY[kind] ?? 'preview.type_file')}</div>
            <div className="mt-1.5 text-[12px] text-ink-faint">
              {t('preview.modified', { time: relTime(file.updatedAt), size, ext })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
