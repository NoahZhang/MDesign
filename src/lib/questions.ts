import type { ContentBlock, Message } from '../pi-ai'

export interface Question {
  id: string
  title: string
  subtitle?: string
  kind: string // 'text-options' | 'svg-options' | 'freeform'
  options?: string[]
  multi?: boolean
}

export interface QuestionSpec {
  title?: string
  questions: Question[]
}

/** Marker the main-process (pi-agent-core) agent leaves as the ask_questions tool
 *  result while it waits — a real toolResult, but means "still unanswered". */
export const ASK_SENTINEL = 'Awaiting user answers'

/**
 * Find an ask_questions tool call still awaiting the user. Handles both runtimes:
 * - Browser agent: the tool call has no toolResult yet.
 * - Electron/pi-agent-core: the loop must answer every tool, so the call has a
 *   sentinel toolResult; it's pending until the user replies with a following turn.
 */
export function findPendingAsk(messages: Message[]): { id: string; spec: QuestionSpec } | null {
  const resultById = new Map(
    messages.filter((m) => m.role === 'toolResult').map((m) => [(m as { toolCallId: string }).toolCallId, m]),
  )
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    // A user turn after the ask means it's answered (or superseded) — nothing pending.
    if (m.role === 'user') return null
    if (m.role === 'assistant') {
      for (const b of m.content as ContentBlock[]) {
        if (b.type === 'toolCall' && b.name === 'ask_questions') {
          const tr = resultById.get(b.id) as { content?: unknown } | undefined
          const sentinel = typeof tr?.content === 'string' && tr.content.includes(ASK_SENTINEL)
          if (!tr || sentinel) return { id: b.id, spec: (b.input ?? {}) as QuestionSpec }
          return null // genuinely answered
        }
      }
    }
  }
  return null
}
