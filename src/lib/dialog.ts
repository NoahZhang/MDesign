import { useSyncExternalStore } from 'react'

// In-app replacements for window.confirm/prompt/alert — needed because wry's WKWebView does
// not implement the JS dialog panels (native confirm/prompt return false/null there). These
// are async; call sites await them. Rendered by <DialogHost/> (mounted once at the app root).

export type DialogReq =
  | { kind: 'confirm'; message: string; danger?: boolean; resolve: (v: boolean) => void }
  | { kind: 'prompt'; message: string; defaultValue: string; resolve: (v: string | null) => void }
  | { kind: 'alert'; message: string; resolve: () => void }

let current: DialogReq | null = null
const queue: DialogReq[] = []
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}
function advance() {
  current = queue.shift() || null
  emit()
}
function push(req: DialogReq) {
  queue.push(req)
  if (!current) advance()
}

export function confirmDialog(message: string, danger = true): Promise<boolean> {
  return new Promise((resolve) => push({ kind: 'confirm', message, danger, resolve }))
}
export function promptDialog(message: string, defaultValue = ''): Promise<string | null> {
  return new Promise((resolve) => push({ kind: 'prompt', message, defaultValue, resolve }))
}
export function alertDialog(message: string): Promise<void> {
  return new Promise((resolve) => push({ kind: 'alert', message, resolve }))
}

export function settleDialog(value: boolean | string | null) {
  if (!current) return
  ;(current.resolve as (v: unknown) => void)(value)
  advance()
}

export function useDialog(): DialogReq | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
    () => current,
  )
}
