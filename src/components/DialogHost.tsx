import { useEffect, useState } from 'react'
import { settleDialog, useDialog } from '../lib/dialog'

export default function DialogHost() {
  const req = useDialog()
  const [value, setValue] = useState('')

  useEffect(() => {
    if (req?.kind === 'prompt') setValue(req.defaultValue)
  }, [req])

  useEffect(() => {
    if (!req) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        settleDialog(req.kind === 'prompt' ? null : req.kind === 'confirm' ? false : true)
      } else if (e.key === 'Enter' && req.kind !== 'prompt') {
        // prompt's own input handles Enter
        e.preventDefault()
        settleDialog(true)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [req])

  if (!req) return null

  const ok = () => settleDialog(req.kind === 'prompt' ? value : true)
  const cancel = () => settleDialog(req.kind === 'prompt' ? null : false)

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-ink/30 p-4" onClick={req.kind === 'alert' ? ok : cancel}>
      <div className="w-full max-w-sm rounded-2xl border border-line bg-panel p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{req.message}</p>
        {req.kind === 'prompt' && (
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                ok()
              }
            }}
            className="mt-3 w-full rounded-lg border border-line bg-white px-3 py-2 text-[14px] text-ink focus:border-coral-muted focus:outline-none"
          />
        )}
        <div className="mt-4 flex justify-end gap-2">
          {req.kind !== 'alert' && (
            <button onClick={cancel} className="rounded-lg px-3 py-2 text-[13.5px] text-ink-muted hover:bg-sink">
              取消
            </button>
          )}
          <button
            onClick={ok}
            autoFocus={req.kind !== 'prompt'}
            className={
              'rounded-lg px-4 py-2 text-[13.5px] font-medium text-white ' +
              (req.kind === 'confirm' && req.danger ? 'bg-coral hover:bg-coral-dark' : 'bg-ink hover:bg-ink-soft')
            }
          >
            {req.kind === 'alert' ? '好' : '确定'}
          </button>
        </div>
      </div>
    </div>
  )
}
