import { useState, type ReactNode } from 'react'
import { Pencil, Plus, Sparkles, Star, Trash2, X } from 'lucide-react'
import { deleteDesignSystem, setDefaultDesignSystem, upsertDesignSystem, useDesignSystems, useSettings } from '../../lib/store'
import { blankDesignSystem } from '../../lib/seed'
import { SPEC_TEMPLATE, designPresets } from '../../lib/designPresets'
import { uid } from '../../lib/id'
import { confirmDialog, alertDialog } from '../../lib/dialog'
import { generateDesignSystemViaIpc, isElectron } from '../../lib/electronAgent'
import { activeCli, activeModel, type DesignSystem } from '../../lib/types'

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[12.5px] font-medium text-ink-soft">{label}</div>
      {children}
      {hint && <p className="mt-1 text-[11.5px] leading-snug text-ink-faint">{hint}</p>}
    </label>
  )
}

export function Palette({ ds, size = 5 }: { ds: DesignSystem; size?: number }) {
  return (
    <span className="flex items-center gap-1">
      {ds.colors.slice(0, 6).map((c, i) => (
        <span key={i} className={`h-${size} w-${size} rounded-full border border-line`} style={{ background: c.value, width: size * 4, height: size * 4 }} title={c.name} />
      ))}
    </span>
  )
}

function Editor({ initial, onDone }: { initial: DesignSystem; onDone: () => void }) {
  const [draft, setDraft] = useState<DesignSystem>(initial)
  const patch = (p: Partial<DesignSystem>) => setDraft((d) => ({ ...d, ...p }))

  const setColor = (i: number, k: 'name' | 'value', v: string) =>
    patch({ colors: draft.colors.map((c, idx) => (idx === i ? { ...c, [k]: v } : c)) })

  const save = () => {
    upsertDesignSystem({ ...draft, name: draft.name.trim() || '未命名设计系统' })
    onDone()
  }

  return (
    <div className="mt-4 space-y-4">
      <Field label="名称">
        <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="例如 Acme Brand" className="input" />
      </Field>

      <Field label="配色" hint="给每个颜色起个名字(会变成 CSS 变量,如 --primary)。">
        <div className="space-y-2">
          {draft.colors.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(c.value) ? c.value : '#000000'}
                onChange={(e) => setColor(i, 'value', e.target.value)}
                className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-line bg-white p-0.5"
              />
              <input value={c.name} onChange={(e) => setColor(i, 'name', e.target.value)} placeholder="primary" className="input w-32 shrink-0" />
              <input value={c.value} onChange={(e) => setColor(i, 'value', e.target.value)} placeholder="#D97757" className="input flex-1 font-mono text-[12.5px]" />
              <button
                onClick={() => patch({ colors: draft.colors.filter((_, idx) => idx !== i) })}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-ink-muted hover:bg-coral-tint hover:text-coral-dark"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <button
            onClick={() => patch({ colors: [...draft.colors, { name: '', value: '#D97757' }] })}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line py-2 text-[13px] font-medium text-ink-soft hover:bg-white"
          >
            <Plus size={15} /> 添加颜色
          </button>
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="标题字体">
          <input value={draft.headingFont} onChange={(e) => patch({ headingFont: e.target.value })} placeholder="Inter" className="input" />
        </Field>
        <Field label="正文字体">
          <input value={draft.bodyFont} onChange={(e) => patch({ bodyFont: e.target.value })} placeholder="Inter" className="input" />
        </Field>
      </div>

      <Field label={`圆角 — ${draft.radius}px`}>
        <input type="range" min={0} max={32} value={draft.radius} onChange={(e) => patch({ radius: Number(e.target.value) })} className="w-full accent-coral" />
      </Field>

      <Field
        label="设计规范 (DESIGN.md)"
        hint="设计系统的核心——氛围、字号阶、组件、间距、阴影、Do/Don't、语气。会作为品牌契约原样给到 agent。颜色/字体/圆角只是它的机器可读摘要。"
      >
        <div className="mb-1.5 flex">
          <button
            type="button"
            onClick={() => patch({ spec: draft.spec.trim() ? draft.spec : SPEC_TEMPLATE })}
            className="ml-auto rounded-md border border-line bg-white px-2 py-1 text-[11.5px] font-medium text-ink-soft hover:bg-panel"
          >
            插入 9 段模板
          </button>
        </div>
        <textarea
          value={draft.spec}
          onChange={(e) => patch({ spec: e.target.value })}
          rows={14}
          placeholder={'## Atmosphere & visual theme\n安静、克制、留白充足……\n\n## Typography\nH1 32/1.2 w600 · Body 16/1.6 w400……'}
          className="input resize-none font-mono text-[12px] leading-relaxed"
        />
      </Field>

      <div className="flex gap-2 pt-1">
        <button onClick={onDone} className="rounded-lg px-3 py-2 text-[13.5px] text-ink-muted hover:bg-sink">
          取消
        </button>
        <button onClick={save} className="ml-auto rounded-lg bg-ink px-4 py-2 text-[13.5px] font-medium text-white hover:bg-ink-soft">
          保存
        </button>
      </div>
    </div>
  )
}

export default function DesignSystemModal({ onClose }: { onClose: () => void }) {
  const { systems, defaultId } = useDesignSystems()
  const settings = useSettings()
  const [editing, setEditing] = useState<DesignSystem | null>(null)
  const [genInput, setGenInput] = useState('')
  const [genLoading, setGenLoading] = useState(false)

  const generate = async () => {
    const q = genInput.trim()
    if (!q || genLoading) return
    const cliMode = settings.agentMode === 'cli'
    const cfg = activeCli(settings)
    const model = activeModel(settings)
    if (cliMode && !cfg) {
      alertDialog('当前是 CLI 模式,但还没有可用的 CLI agent。请在「模型配置」里添加 codex / opencode,或切回 API 模型。')
      return
    }
    if (!cliMode && (!model || !model.model?.trim() || !model.apiKey?.trim())) {
      alertDialog('请先在「模型配置」里设置一个可用的 API 模型,或切到 CLI(opencode/codex)——生成设计系统需要一个可用的 agent。')
      return
    }
    const looksUrl = /^https?:\/\//i.test(q) || /^[\w-]+(\.[\w-]+)+(\/|$)/.test(q)
    const url = looksUrl ? (/^https?:\/\//i.test(q) ? q : 'https://' + q) : undefined
    const text = looksUrl ? '' : q
    setGenLoading(true)
    try {
      const res = await generateDesignSystemViaIpc(
        cliMode ? { mode: 'cli', cfg, url, text } : { mode: 'api', model, url, text },
      )
      setEditing({
        ...blankDesignSystem(),
        name: res.name,
        colors: res.colors,
        headingFont: res.headingFont,
        bodyFont: res.bodyFont,
        radius: res.radius,
        spec: res.spec,
      })
      setGenInput('')
    } catch (e) {
      alertDialog('生成失败:' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setGenLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4" onClick={onClose}>
      <div
        className="thin-scrollbar max-h-[88vh] w-full max-w-[520px] overflow-y-auto rounded-2xl border border-line bg-panel p-6 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-semibold text-ink">设计系统</h2>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md text-ink-muted hover:bg-sink">
            <X size={17} />
          </button>
        </div>

        {editing ? (
          <Editor initial={editing} onDone={() => setEditing(null)} />
        ) : (
          <>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
              可以建多套品牌。标 ★ 的是<b>默认</b>——新项目和未单独指定的项目都用它;每个项目也可以在工作区里单独选用某一套或不用。
            </p>

            {isElectron() && (
              <div className="mt-4 rounded-xl border border-coral-muted/60 bg-coral-tint/30 p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-ink-soft">
                  <Sparkles size={14} className="text-coral-dark" /> 从网址或描述自动生成
                </div>
                <div className="flex gap-2">
                  <input
                    value={genInput}
                    onChange={(e) => setGenInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                        e.preventDefault()
                        generate()
                      }
                    }}
                    disabled={genLoading}
                    placeholder="粘贴网址(如 stripe.com)或描述(如 暗色科技风)…"
                    className="input flex-1 disabled:opacity-60"
                  />
                  <button
                    onClick={generate}
                    disabled={genLoading || !genInput.trim()}
                    className="shrink-0 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-white hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {genLoading ? '生成中…' : '生成'}
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] leading-snug text-ink-faint">
                  会读取网址真实的配色 / 字体 / 圆角,并让模型产出一套完整设计系统(含 DESIGN.md);生成后可再编辑。
                </p>
              </div>
            )}

            <div className="mt-4 space-y-2">
              {systems.map((s) => {
                const isDefault = defaultId === s.id
                return (
                  <div key={s.id} className={'flex items-center gap-3 rounded-lg border bg-white px-3 py-2.5 ' + (isDefault ? 'border-coral-muted' : 'border-line')}>
                    <button
                      onClick={() => setDefaultDesignSystem(isDefault ? '' : s.id)}
                      className={'grid h-7 w-7 shrink-0 place-items-center rounded-md ' + (isDefault ? 'text-coral-dark' : 'text-ink-faint hover:text-ink')}
                      title={isDefault ? '取消默认' : '设为默认'}
                    >
                      <Star size={16} fill={isDefault ? 'currentColor' : 'none'} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium text-ink">
                        {s.name || '未命名'}
                        {isDefault && <span className="ml-2 rounded-full bg-coral-tint px-1.5 py-0.5 text-[10.5px] font-medium text-coral-dark">默认</span>}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <Palette ds={s} size={4} />
                        {(s.headingFont || s.bodyFont) && (
                          <span className="truncate text-[11.5px] text-ink-faint">{s.headingFont || s.bodyFont}</span>
                        )}
                      </div>
                    </div>
                    <button onClick={() => setEditing(s)} className="grid h-7 w-7 place-items-center rounded-md text-ink-muted hover:bg-sink" title="编辑">
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={async () => {
                        if (await confirmDialog(`删除设计系统「${s.name || '未命名'}」？`)) deleteDesignSystem(s.id)
                      }}
                      className="grid h-7 w-7 place-items-center rounded-md text-ink-muted hover:bg-coral-tint hover:text-coral-dark"
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )
              })}
              {systems.length === 0 && (
                <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-ink-muted">
                  还没有设计系统,点下面创建一套。
                </div>
              )}
            </div>

            <button
              onClick={() => setEditing(blankDesignSystem())}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-white py-2.5 text-[13.5px] font-medium text-ink-soft hover:bg-panel"
            >
              <Plus size={16} /> 新建设计系统
            </button>

            <div className="mt-4 text-[11.5px] font-medium text-ink-faint">或从预置开始(会复制一份,可再编辑)</div>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {designPresets().map((p) => (
                <button
                  key={p.id}
                  onClick={() => setEditing({ ...p, id: uid('ds') })}
                  className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-[12.5px] text-ink-soft hover:bg-panel"
                  title={`从「${p.name}」预置开始`}
                >
                  <Palette ds={p} size={3} />
                  {p.name}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
