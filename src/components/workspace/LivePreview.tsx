import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { useT } from '../../lib/i18n'
import type { AgentStatus } from '../../agent/agent'

const fmtKB = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`)

/** Shows a file's contents streaming in live as the agent writes it. */
export function LivePreview({ path, content }: { path: string; content: string }) {
  const t = useT()
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [content])

  return (
    <div className="flex h-full flex-col bg-paper">
      <div className="flex items-center gap-2 border-b border-line bg-panel px-4 py-2.5">
        <Loader2 size={14} className="animate-spin text-coral" />
        <span className="text-[13px] font-medium text-ink">{t('preview.generating')}</span>
        <span className="truncate font-mono text-[12px] text-ink-muted">{path}</span>
        <span className="ml-auto shrink-0 tabular-nums text-[12px] text-ink-faint">{fmtKB(content.length)}</span>
      </div>
      <div ref={scrollRef} className="thin-scrollbar min-h-0 flex-1 overflow-auto bg-[#1F1E1B]">
        <pre className="p-5 font-mono text-[12px] leading-relaxed text-[#EDEAE0]">
          <code>{content}</code>
        </pre>
      </div>
    </div>
  )
}

/** Shown in the preview area while the agent is thinking/planning (no file yet). */
export function WorkingPane({ status }: { status: AgentStatus | null }) {
  const t = useT()
  return (
    <div className="grid h-full place-items-center bg-paper">
      <div className="flex flex-col items-center text-center">
        <Loader2 size={22} className="animate-spin text-coral" />
        <p className="mt-3 text-[14px] font-medium text-ink">
          {status?.label ?? t('preview.working')}
          <span className="status-dots" />
        </p>
        <p className="mt-1.5 max-w-[260px] text-[12.5px] leading-relaxed text-ink-faint">
          {t('preview.working_desc')}
        </p>
      </div>
    </div>
  )
}
