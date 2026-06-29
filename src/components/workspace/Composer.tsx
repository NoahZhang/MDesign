import { useRef, useState } from 'react'
import { Check, ChevronDown, FileText, Loader2, Palette, Paperclip, Play, Square, X } from 'lucide-react'
import { setProjectDesignSystem, updateSettings, useDesignSystems, useSettings } from '../../lib/store'
import { alertDialog } from '../../lib/dialog'
import { extractPdfText, type PdfDoc } from '../../lib/pdfText'
import { activeCli, activeModel, cliLabel, resolveDesignSystem, type Project } from '../../lib/types'

type Img = { id: string; data: string; mimeType: string; name: string }

function readImage(file: File): Promise<Img | null> {
  return new Promise((resolve) => {
    const r = new FileReader()
    r.onload = () => {
      const m = String(r.result).match(/^data:([^;]+);base64,(.*)$/)
      resolve(m ? { id: Math.random().toString(36).slice(2), mimeType: m[1], data: m[2], name: file.name } : null)
    }
    r.onerror = () => resolve(null)
    r.readAsDataURL(file)
  })
}

export default function Composer({
  project,
  running,
  onSend,
  onStop,
}: {
  project: Project
  running: boolean
  onSend: (text: string, images: { data: string; mimeType: string }[], docs: PdfDoc[]) => void
  onStop: () => void
}) {
  const settings = useSettings()
  const dss = useDesignSystems()
  const [text, setText] = useState('')
  const [images, setImages] = useState<Img[]>([])
  const [docs, setDocs] = useState<(PdfDoc & { id: string })[]>([])
  const [extracting, setExtracting] = useState(0)
  const [menu, setMenu] = useState(false)
  const [dsMenu, setDsMenu] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const models = settings.models
  const cliAgents = settings.cliAgents ?? []
  const cliMode = settings.agentMode === 'cli'
  const activeCliAgent = activeCli(settings)
  const modelName = cliMode
    ? (activeCliAgent ? cliLabel(activeCliAgent) : '未配置 CLI')
    : (activeModel(settings)?.name ?? '未配置模型')

  const activeDs = resolveDesignSystem(dss, project)
  const dsName = project.designSystemId === null ? '无设计系统' : activeDs?.name || '无设计系统'

  const addFiles = async (files: File[]) => {
    if (!files.length) return
    const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
    const imgFiles = files.filter((f) => !pdfs.includes(f) && (f.type.startsWith('image/') || !f.type))
    const unsupported = files.filter((f) => !pdfs.includes(f) && !imgFiles.includes(f))
    if (unsupported.length) {
      alertDialog(`不支持的文件类型：${unsupported.map((f) => f.name).join('、')}\n聊天附件目前支持图片和 PDF。`)
    }
    if (imgFiles.length) {
      const imgs = (await Promise.all(imgFiles.map(readImage))).filter((x): x is Img => !!x)
      if (imgs.length < imgFiles.length) alertDialog('部分图片读取失败，已跳过。')
      setImages((prev) => [...prev, ...imgs])
    }
    for (const f of pdfs) {
      setExtracting((n) => n + 1)
      try {
        const doc = await extractPdfText(f)
        if (doc.text.trim().length < 20) {
          alertDialog(
            `未能从「${f.name}」提取到文字——它可能是扫描版/图片型 PDF（没有文字层）。\n可以把关键页截图后作为图片发送，模型能看图。`,
          )
        } else {
          setDocs((prev) => [...prev, { ...doc, id: Math.random().toString(36).slice(2) }])
        }
      } catch (e) {
        const stack = e instanceof Error && e.stack ? '\n' + e.stack.split('\n').slice(0, 2).join('\n') : ''
        alertDialog(`无法解析「${f.name}」：${e instanceof Error ? e.message : String(e)}${stack}`)
      } finally {
        setExtracting((n) => n - 1)
      }
    }
  }

  const submit = () => {
    const t = text.trim()
    if ((!t && images.length === 0 && docs.length === 0) || running || extracting > 0) return
    onSend(t, images.map(({ data, mimeType }) => ({ data, mimeType })), docs.map(({ name, pages, text: dt }) => ({ name, pages, text: dt })))
    setText('')
    setImages([])
    setDocs([])
    if (taRef.current) taRef.current.style.height = 'auto'
  }

  const grow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 180) + 'px'
  }

  return (
    <div className="rounded-2xl border border-line bg-white p-3 shadow-card">
      {(docs.length > 0 || extracting > 0) && (
        <div className="mb-2 flex flex-wrap gap-2">
          {docs.map((d) => (
            <span key={d.id} className="flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-soft">
              <FileText size={14} className="shrink-0 text-coral-dark" />
              <span className="max-w-[180px] truncate">{d.name}</span>
              <span className="text-ink-faint">{d.pages}页</span>
              <button onClick={() => setDocs((p) => p.filter((x) => x.id !== d.id))} className="ml-0.5 text-ink-faint hover:text-ink">
                <X size={12} />
              </button>
            </span>
          ))}
          {extracting > 0 && (
            <span className="flex items-center gap-1.5 rounded-lg border border-dashed border-line px-2.5 py-1.5 text-[12.5px] text-ink-muted">
              <Loader2 size={13} className="animate-spin" /> 正在解析 PDF…
            </span>
          )}
        </div>
      )}
      {images.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {images.map((im) => (
            <div key={im.id} className="group relative">
              <img
                src={`data:${im.mimeType};base64,${im.data}`}
                alt={im.name}
                className="h-16 w-16 rounded-lg border border-line object-cover"
              />
              <button
                onClick={() => setImages((p) => p.filter((x) => x.id !== im.id))}
                className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-ink text-white opacity-0 transition-opacity group-hover:opacity-100"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          grow(e.target)
        }}
        onKeyDown={(e) => {
          // Ignore Enter while an IME composition is active (e.g. confirming a
          // Chinese candidate) — it must not submit the message.
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.items)
            .filter((i) => i.type.startsWith('image/'))
            .map((i) => i.getAsFile())
            .filter((f): f is File => !!f)
          if (files.length) {
            e.preventDefault()
            addFiles(files)
          }
        }}
        rows={1}
        placeholder="Describe what you want to create..."
        className="max-h-[180px] w-full resize-none bg-transparent px-1 text-[14.5px] leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none"
      />

      <input
        ref={fileRef}
        type="file"
        accept="image/*,.pdf,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />

      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          className="grid h-8 w-8 place-items-center rounded-lg border border-line text-ink-muted hover:bg-panel"
          title="附加图片或 PDF"
        >
          <Paperclip size={16} />
        </button>
        <div className="relative">
          <button
            onClick={() => setDsMenu((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-ink-soft hover:bg-panel"
            title="设计系统"
          >
            <Palette size={14} className="text-ink-faint" />
            <span className="max-w-[120px] truncate">{dsName}</span>
            <ChevronDown size={13} className="text-ink-faint" />
          </button>
          {dsMenu && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setDsMenu(false)} />
              <div className="absolute bottom-full left-0 z-30 mb-1 w-56 rounded-xl border border-line bg-white p-1 shadow-pop">
                <div className="px-3 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">设计系统</div>
                {(
                  [
                    {
                      key: 'default',
                      label: `跟随默认${dss.systems.find((s) => s.id === dss.defaultId)?.name ? `（${dss.systems.find((s) => s.id === dss.defaultId)!.name}）` : '（无）'}`,
                      checked: project.designSystemId === undefined,
                      pick: undefined as string | null | undefined,
                    },
                    { key: 'none', label: '不使用', checked: project.designSystemId === null, pick: null },
                    ...dss.systems.map((s) => ({
                      key: s.id,
                      label: s.name || '未命名',
                      checked: project.designSystemId === s.id,
                      pick: s.id as string | null | undefined,
                    })),
                  ] as { key: string; label: string; checked: boolean; pick: string | null | undefined }[]
                ).map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => {
                      setProjectDesignSystem(project.id, opt.pick)
                      setDsMenu(false)
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-ink-soft hover:bg-panel"
                  >
                    <span className="grid w-4 shrink-0 place-items-center">{opt.checked && <Check size={13} className="text-coral-dark" />}</span>
                    <span className="truncate">{opt.label}</span>
                  </button>
                ))}
                {dss.systems.length === 0 && (
                  <div className="px-3 py-1.5 text-[12px] leading-relaxed text-ink-muted">还没有设计系统,在首页「设计系统」里创建或生成。</div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="relative ml-auto">
          <button
            onClick={() => setMenu((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-ink-soft hover:bg-panel"
          >
            {modelName}
            <ChevronDown size={13} className="text-ink-faint" />
          </button>
          {menu && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setMenu(false)} />
              <div className="absolute bottom-full right-0 z-30 mb-1 w-60 rounded-xl border border-line bg-white p-1 shadow-pop">
                <div className="px-3 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">API 模型</div>
                {models.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      updateSettings({ agentMode: 'api', activeId: m.id })
                      setMenu(false)
                    }}
                    className={
                      'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] hover:bg-panel ' +
                      (!cliMode && settings.activeId === m.id ? 'font-medium text-ink' : 'text-ink-soft')
                    }
                  >
                    <span className="truncate">{m.name}</span>
                    <span className="ml-2 shrink-0 text-[11px] text-ink-faint">{m.api}</span>
                  </button>
                ))}
                {models.length === 0 && (
                  <div className="px-3 py-1.5 text-[12px] leading-relaxed text-ink-muted">还没有模型，在「模型配置」里添加。</div>
                )}
                <div className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">CLI agents</div>
                {cliAgents.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      updateSettings({ agentMode: 'cli', activeCliId: c.id })
                      setMenu(false)
                    }}
                    className={
                      'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] hover:bg-panel ' +
                      (cliMode && (settings.activeCliId === c.id || (!settings.activeCliId && cliAgents[0]?.id === c.id)) ? 'font-medium text-ink' : 'text-ink-soft')
                    }
                  >
                    <span className="truncate">{cliLabel(c)}</span>
                    <span className="ml-2 shrink-0 text-[11px] text-ink-faint">{c.kind}</span>
                  </button>
                ))}
                {cliAgents.length === 0 && (
                  <div className="px-3 py-1.5 text-[12px] leading-relaxed text-ink-muted">无 CLI;在「模型配置」里添加 codex / opencode。</div>
                )}
              </div>
            </>
          )}
        </div>

        {running ? (
          <button
            onClick={onStop}
            className="grid h-9 w-9 place-items-center rounded-lg bg-ink text-white hover:bg-ink-soft"
            title="Stop"
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={(!text.trim() && images.length === 0 && docs.length === 0) || extracting > 0}
            className="flex items-center gap-1.5 rounded-lg bg-coral px-3.5 py-2 text-[13.5px] font-medium text-white transition-colors hover:bg-coral-dark disabled:cursor-not-allowed disabled:bg-coral-muted"
            title="Send"
          >
            <Play size={13} fill="currentColor" />
            Send
          </button>
        )}
      </div>
    </div>
  )
}
