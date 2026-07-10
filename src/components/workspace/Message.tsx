import { useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Eye, FileText, FolderOpen, Pencil, ThumbsDown, ThumbsUp, Trash2, Wrench } from 'lucide-react'
import { PDF_MARK, pdfBlockLabel } from '../../lib/pdfText'
import { useT } from '../../lib/i18n'
import type { ContentBlock, Message as Msg, ToolCallBlock } from '../../pi-ai'

// Render markdown links so they never navigate the SPA away (a relative href like
// `index.html` would otherwise blow the whole app to a non-existent route). External
// links open in a new tab (→ the default browser inside the desktop app).
function MdLink({ href, children }: { href?: string; children?: ReactNode }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault()
        const h = href || ''
        if (/^(https?:|mailto:|tel:)/i.test(h)) window.open(h, '_blank', 'noopener')
      }}
    >
      {children}
    </a>
  )
}

const TOOL_META: Record<string, { icon: typeof Pencil; labelKey: string }> = {
  write_file: { icon: Pencil, labelKey: 'message.tool_wrote' },
  str_replace_edit: { icon: Pencil, labelKey: 'message.tool_edited' },
  read_file: { icon: FolderOpen, labelKey: 'message.tool_read' },
  list_files: { icon: FolderOpen, labelKey: 'message.tool_listed' },
  delete_file: { icon: Trash2, labelKey: 'message.tool_deleted' },
  done: { icon: Eye, labelKey: 'message.tool_opened' },
}

function filePathOf(call: ToolCallBlock): string {
  const i = (call.input ?? {}) as Record<string, any>
  if (i.path) return String(i.path)
  if (Array.isArray(i.paths) && i.paths.length) return i.paths.join(', ')
  return ''
}

// Compact tool calls: a wrapping row of small pills, merging consecutive same-name
// calls into "name ×N" (a CLI run can emit dozens of read/edit/bash). A single call
// with a real file path stays clickable (opens it); merged/CLI pills are just labels.
function ToolPills({ tools, onOpen }: { tools: ToolCallBlock[]; onOpen?: (p: string) => void }) {
  const t = useT()
  const groups: { name: string; calls: ToolCallBlock[] }[] = []
  for (const tc of tools) {
    const last = groups[groups.length - 1]
    if (last && last.name === tc.name) last.calls.push(tc)
    else groups.push({ name: tc.name, calls: [tc] })
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {groups.map((g) => {
        const meta = TOOL_META[g.name]
        const Icon = meta?.icon ?? Wrench
        const label = meta ? t(meta.labelKey) : g.name
        const path = g.calls.length === 1 ? filePathOf(g.calls[0]) : ''
        const clickable = !!path
        return (
          <button
            key={g.calls[0].id}
            onClick={() => clickable && onOpen?.(path)}
            title={path || label}
            className={
              'inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-panel px-2 py-1 text-[12px] text-ink-soft transition-colors ' +
              (clickable ? 'cursor-pointer hover:border-line-strong hover:bg-white' : 'cursor-default')
            }
          >
            <Icon size={12} className="shrink-0 text-coral-dark" />
            <span className="font-medium">{label}</span>
            {g.calls.length > 1 && <span className="text-ink-faint">×{g.calls.length}</span>}
            {path && <span className="truncate font-mono text-[11px] text-ink-muted">{path}</span>}
          </button>
        )
      })}
    </div>
  )
}

export default function MessageView({
  message,
  onOpenFile,
  streaming,
}: {
  message: Msg
  onOpenFile?: (p: string) => void
  streaming?: boolean
}) {
  const t = useT()
  const [vote, setVote] = useState<'up' | 'down' | null>(null)
  if (message.role === 'toolResult') {
    // Surface the user's answers to a question form as a user-style bubble.
    if (message.toolName === 'ask_questions') {
      return (
        <div className="flex justify-end">
          <div className="max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-sink px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink-soft">
            {message.content}
          </div>
        </div>
      )
    }
    return null
  }

  if (message.role === 'user') {
    const blocks = typeof message.content === 'string' ? null : (message.content as ContentBlock[])
    const textBlocks = blocks ? blocks.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text') : []
    // PDF attachment blocks render as compact chips; their full text only goes to the model.
    const pdfLabels = textBlocks.filter((b) => b.text.startsWith(PDF_MARK)).map((b) => pdfBlockLabel(b.text))
    const text = blocks
      ? textBlocks.filter((b) => !b.text.startsWith(PDF_MARK)).map((b) => b.text).join('\n')
      : (message.content as string)
    const imgs = blocks ? blocks.filter((b): b is Extract<ContentBlock, { type: 'image' }> => b.type === 'image') : []
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-2xl rounded-br-md bg-sink px-3.5 py-2.5 text-[14.5px] leading-relaxed text-ink">
          {imgs.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {imgs.map((im, i) => (
                <img
                  key={i}
                  src={`data:${im.mimeType};base64,${im.data}`}
                  alt={t('message.attachment_alt')}
                  className="max-h-40 rounded-lg border border-line/60 object-cover"
                />
              ))}
            </div>
          )}
          {pdfLabels.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {pdfLabels.map((l, i) => (
                <span key={i} className="flex items-center gap-1.5 rounded-lg border border-line/60 bg-white/60 px-2 py-1 text-[12px] text-ink-soft">
                  <FileText size={13} className="text-coral-dark" /> {l}
                </span>
              ))}
            </div>
          )}
          {text && <div className="whitespace-pre-wrap">{text}</div>}
        </div>
      </div>
    )
  }

  const blocks = message.content as ContentBlock[]
  const text = blocks
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('\n\n')
  const tools = blocks.filter((b): b is ToolCallBlock => b.type === 'toolCall' && b.name !== 'ask_questions')

  return (
    <div className="space-y-2.5">
      {text && (
        <div className="md">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: MdLink }}>
            {text}
          </ReactMarkdown>
          {streaming && <span className="ml-0.5 inline-block h-3.5 w-[3px] animate-pulse rounded-full bg-coral align-middle" />}
        </div>
      )}
      {tools.length > 0 && <ToolPills tools={tools} onOpen={onOpenFile} />}
      {!streaming && text && (
        <div className="flex items-center gap-1 pt-0.5">
          <button
            onClick={() => setVote(vote === 'up' ? null : 'up')}
            className={
              'grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-sink ' +
              (vote === 'up' ? 'text-coral-dark' : 'text-ink-faint')
            }
          >
            <ThumbsUp size={14} />
          </button>
          <button
            onClick={() => setVote(vote === 'down' ? null : 'down')}
            className={
              'grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-sink ' +
              (vote === 'down' ? 'text-coral-dark' : 'text-ink-faint')
            }
          >
            <ThumbsDown size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
