import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { resolveModel } from '../../pi-ai'
import type { Message } from '../../pi-ai'
import type { AgentStatus } from '../../agent/agent'
import { getSystemPrompt } from '../../agent/systemPrompt'
import { clearMessages, useSettings } from '../../lib/store'
import { useT } from '../../lib/i18n'
import { activeModel } from '../../lib/types'
import type { Project } from '../../lib/types'
import Composer from './Composer'
import MessageView from './Message'

export default function ChatPanel({
  project,
  messages,
  running,
  status,
  onSend,
  onStop,
}: {
  project: Project
  messages: Message[]
  running: boolean
  status: AgentStatus | null
  onSend: (text: string, images: { data: string; mimeType: string }[]) => void
  onStop: () => void
}) {
  const t = useT()
  const settings = useSettings()
  const [bannerHidden, setBannerHidden] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, running, status])

  // Context usage vs the active model's window. The banner only shows past 80%.
  const usage = useMemo(() => {
    const convChars = project.messages.reduce((n, m) => {
      const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      return n + c.length
    }, 0)
    const convTokens = convChars / 4
    const sysTokens = getSystemPrompt('full').length / 4
    const cfg = activeModel(settings)
    const window = cfg?.contextWindow ?? (cfg ? resolveModel(cfg.model, cfg.api).contextWindow : undefined) ?? 128000
    return { convK: Math.round(convTokens / 100) / 10, fraction: (convTokens + sysTokens) / window }
  }, [project.messages, settings])

  const lastIdx = messages.length - 1
  const showBanner = !running && !bannerHidden && usage.fraction >= 0.8

  return (
    <div className="flex h-full flex-col bg-panel">
      <div ref={scrollRef} className="thin-scrollbar flex-1 overflow-y-auto px-5 py-5">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-[15px] font-medium text-ink">{t('chat.empty_title')}</p>
            <p className="mt-1.5 max-w-[260px] text-[13.5px] leading-relaxed text-ink-muted">
              {t('chat.empty_desc')}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {messages.map((m, i) => (
              <MessageView key={i} message={m} streaming={running && i === lastIdx && m.role === 'assistant'} />
            ))}

            {running && status && (
              <div className="flex items-center gap-2 pl-0.5 text-[13px] text-ink-muted">
                <Loader2 size={14} className="animate-spin text-coral" />
                <span className="font-medium text-ink-soft">{status.label}</span>
                <span className="status-dots" />
              </div>
            )}

            {showBanner && (
              <div className="rounded-xl border border-coral-muted/50 bg-coral-tint px-4 py-3.5">
                <div className="text-[14px] font-semibold text-ink">
                  {t('chat.save_banner', { k: usage.convK })}
                </div>
                <div className="mt-0.5 text-[13px] text-ink-muted">{t('chat.save_banner_sub')}</div>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => {
                      clearMessages(project.id)
                      setBannerHidden(true)
                    }}
                    className="rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-panel"
                  >
                    {t('chat.new_chat')}
                  </button>
                  <button
                    onClick={() => setBannerHidden(true)}
                    className="px-2 py-1.5 text-[13px] text-ink-muted hover:text-ink"
                  >
                    {t('chat.continue_here')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="px-4 pb-4 pt-1">
        <Composer project={project} running={running} onSend={onSend} onStop={onStop} />
      </div>
    </div>
  )
}
