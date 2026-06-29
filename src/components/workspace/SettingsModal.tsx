import { useEffect, useState, type ReactNode } from 'react'
import { Pencil, Plus, RotateCw, Trash2, X } from 'lucide-react'
import { updateSettings, useSettings } from '../../lib/store'
import { uid } from '../../lib/id'
import type { CliAgentConfig, ModelConfig } from '../../lib/types'

const blank = (): ModelConfig => ({ id: uid('m'), name: '', api: 'anthropic', model: '', baseUrl: '', apiKey: '' })

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[12.5px] font-medium text-ink-soft">{label}</div>
      {children}
    </label>
  )
}

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useSettings()
  const [editing, setEditing] = useState<ModelConfig | null>(null)
  const isNew = editing ? !settings.models.some((m) => m.id === editing.id) : false

  const setActive = (id: string) => updateSettings({ activeId: id })

  // ---- CLI agents (codex / opencode) ----
  const cliAgents = settings.cliAgents ?? []
  const setCli = (next: CliAgentConfig[]) => updateSettings({ cliAgents: next })
  const patchCli = (i: number, patch: Partial<CliAgentConfig>) =>
    setCli(cliAgents.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  const addCli = () => setCli([...cliAgents, { id: uid('cli'), kind: 'codex', command: 'codex' }])
  const removeCli = (i: number) => {
    const next = cliAgents.filter((_, idx) => idx !== i)
    const activeCliId = next.some((c) => c.id === settings.activeCliId) ? settings.activeCliId : next[0]?.id ?? ''
    updateSettings({ cliAgents: next, activeCliId, agentMode: next.length ? settings.agentMode : 'api' })
  }
  // No width here — callers add flex-1 / w-28 / w-full as needed (mixing w-full with
  // flex-1 produced conflicting width classes → squished boxes).
  const cliInput = 'rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-ink-faint focus:border-coral-muted focus:outline-none'

  // Fetch the models a CLI supports (opencode lists them; codex has none) for the
  // model dropdown. Cached per agent id; refreshable per agent.
  const [cliModels, setCliModels] = useState<Record<string, string[]>>({})
  const fetchCliModels = (c: CliAgentConfig) => {
    const cliApi = (window as unknown as { mdesign?: { agent?: { cliModels?: (cfg: unknown) => Promise<string[]> } } }).mdesign?.agent
    if (!cliApi?.cliModels) return
    cliApi.cliModels({ kind: c.kind, command: c.command, proxy: c.proxy }).then((list) => setCliModels((m) => ({ ...m, [`${c.id}:${c.kind}`]: list || [] })))
  }
  useEffect(() => {
    for (const c of settings.cliAgents ?? []) if (!(`${c.id}:${c.kind}` in cliModels)) fetchCliModels(c)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.cliAgents])

  const remove = (id: string) => {
    const models = settings.models.filter((m) => m.id !== id)
    const activeId = settings.activeId === id ? (models[0]?.id ?? '') : settings.activeId
    updateSettings({ models, activeId })
  }

  const save = () => {
    if (!editing) return
    const cfg: ModelConfig = { ...editing, name: editing.name.trim() || editing.model.trim() || '未命名模型' }
    const exists = settings.models.some((m) => m.id === cfg.id)
    const models = exists ? settings.models.map((m) => (m.id === cfg.id ? cfg : m)) : [...settings.models, cfg]
    updateSettings({ models, activeId: exists ? settings.activeId : cfg.id })
    setEditing(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4" onClick={onClose}>
      <div
        className="thin-scrollbar max-h-[88vh] w-full max-w-[480px] overflow-y-auto rounded-2xl border border-line bg-panel p-6 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-semibold text-ink">模型配置</h2>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md text-ink-muted hover:bg-sink">
            <X size={17} />
          </button>
        </div>

        {editing ? (
          /* ---- add / edit a model ---- */
          <div className="mt-4 space-y-4">
            <div className="text-[13px] text-ink-muted">{isNew ? '添加模型' : '编辑模型'}</div>
            <Field label="名称">
              <input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="例如 ark-code-latest"
                className="input"
              />
            </Field>
            <Field label="Provider（接口协议）">
              <div className="flex gap-2">
                {(['anthropic', 'openai'] as const).map((api) => (
                  <button
                    key={api}
                    onClick={() => setEditing({ ...editing, api })}
                    className={
                      'flex-1 rounded-lg border px-3 py-2 text-[13.5px] font-medium capitalize transition-colors ' +
                      (editing.api === api
                        ? 'border-coral-muted bg-coral-tint text-ink'
                        : 'border-line bg-white text-ink-muted hover:text-ink')
                    }
                  >
                    {api}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="模型 ID">
              <input
                value={editing.model}
                onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                placeholder={editing.api === 'anthropic' ? 'ark-code-latest / claude-…' : 'gpt-4o / …'}
                className="input"
              />
            </Field>
            <Field label="API Key">
              <input
                type="password"
                value={editing.apiKey}
                onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
                placeholder={editing.api === 'anthropic' ? 'sk-ant-… / Ark key' : 'sk-…'}
                className="input"
                autoComplete="off"
              />
            </Field>
            <Field label="Base URL（可选）">
              <input
                value={editing.baseUrl}
                onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })}
                placeholder={editing.api === 'anthropic' ? '/llm/anthropic 或 /llm/ark/api/coding' : '/llm/openai'}
                className="input"
              />
              <p className="mt-1.5 text-[11.5px] leading-snug text-ink-faint">
                留空走默认代理。火山方舟填 <span className="font-mono">/llm/ark/api/coding</span>；其它 OpenAI
                兼容端点（Ollama/vLLM/OpenRouter）填它们的地址。
              </p>
            </Field>

            <div className="flex gap-2 pt-1">
              <button onClick={() => setEditing(null)} className="rounded-lg px-3 py-2 text-[13.5px] text-ink-muted hover:bg-sink">
                取消
              </button>
              <button
                onClick={save}
                disabled={!editing.model.trim()}
                className="ml-auto rounded-lg bg-ink px-4 py-2 text-[13.5px] font-medium text-white hover:bg-ink-soft disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
        ) : (
          /* ---- model list ---- */
          <>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
              添加你自己的模型（Anthropic 或 OpenAI 兼容），选一个作为当前使用。
            </p>

            <div className="mt-4 space-y-2">
              {settings.models.map((m) => {
                const active = settings.activeId === m.id
                return (
                  <div
                    key={m.id}
                    className={
                      'flex items-center gap-3 rounded-lg border bg-white px-3 py-2.5 ' +
                      (active ? 'border-coral-muted' : 'border-line')
                    }
                  >
                    <button
                      onClick={() => setActive(m.id)}
                      className={
                        'grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ' +
                        (active ? 'border-coral' : 'border-line-strong')
                      }
                    >
                      {active && <span className="h-2.5 w-2.5 rounded-full bg-coral" />}
                    </button>
                    <button onClick={() => setActive(m.id)} className="min-w-0 flex-1 text-left">
                      <div className="truncate text-[14px] font-medium text-ink">{m.name}</div>
                      <div className="truncate text-[12px] text-ink-muted">
                        {m.api} · {m.model || '未填模型ID'} · {m.apiKey ? 'Key ✓' : '无 Key'}
                      </div>
                    </button>
                    <button
                      onClick={() => setEditing(m)}
                      className="grid h-7 w-7 place-items-center rounded-md text-ink-muted hover:bg-sink"
                      title="编辑"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => remove(m.id)}
                      className="grid h-7 w-7 place-items-center rounded-md text-ink-muted hover:bg-coral-tint hover:text-coral-dark"
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )
              })}
              {settings.models.length === 0 && (
                <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-ink-muted">
                  还没有模型，点下面添加一个。
                </div>
              )}
            </div>

            <button
              onClick={() => setEditing(blank())}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-white py-2.5 text-[13.5px] font-medium text-ink-soft hover:bg-panel"
            >
              <Plus size={16} /> 添加模型
            </button>

            <div className="mt-6 border-t border-line pt-4">
              <div className="mb-2 text-[12.5px] font-medium text-ink-soft">
                CLI agents <span className="font-normal text-ink-faint">· 本地编程 CLI(仅桌面版)</span>
              </div>
              <div className="space-y-3">
                {cliAgents.map((c, i) => (
                  <div key={c.id} className="space-y-2 rounded-lg border border-line p-3">
                    <div className="flex items-center gap-2">
                      <select
                        value={c.kind}
                        onChange={(e) => {
                          const kind = e.target.value as CliAgentConfig['kind']
                          const patch: Partial<CliAgentConfig> = { kind }
                          // keep the command in sync when it's still the default for the old kind
                          if (!c.command || ['codex', 'opencode', 'claude'].includes(c.command)) patch.command = kind
                          patchCli(i, patch)
                        }}
                        className={cliInput + ' min-w-0 flex-1'}
                      >
                        <option value="codex">codex</option>
                        <option value="opencode">opencode</option>
                        <option value="claude">claude</option>
                      </select>
                      <button onClick={() => removeCli(i)} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-muted hover:bg-coral-tint hover:text-coral-dark" title="删除">
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <input value={c.command ?? ''} onChange={(e) => patchCli(i, { command: e.target.value })} placeholder={`可执行命令(默认 ${c.kind},可填绝对路径)`} className={cliInput + ' w-full'} />
                    <input value={c.proxy ?? ''} onChange={(e) => patchCli(i, { proxy: e.target.value })} placeholder="代理(可选,如 http://127.0.0.1:6152)" className={cliInput + ' w-full'} />
                    <div className="flex gap-2">
                      <input
                        value={c.model ?? ''}
                        onChange={(e) => patchCli(i, { model: e.target.value })}
                        list={`cli-models-${c.id}-${c.kind}`}
                        placeholder={
                          c.kind === 'opencode'
                            ? '模型(下拉选或手填 provider/model)'
                            : c.kind === 'claude'
                              ? '模型(下拉选或手填,如 sonnet/opus)'
                              : '模型(下拉选或手填,如 gpt-5.5)'
                        }
                        className={cliInput + ' min-w-0 flex-1'}
                      />
                      <datalist id={`cli-models-${c.id}-${c.kind}`}>
                        {(cliModels[`${c.id}:${c.kind}`] ?? []).map((m) => (
                          <option key={m} value={m} />
                        ))}
                      </datalist>
                      {c.kind === 'opencode' && (
                        <button
                          onClick={() => fetchCliModels(c)}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-ink-muted hover:bg-panel"
                          title="拉取该 CLI 支持的模型"
                        >
                          <RotateCw size={14} />
                        </button>
                      )}
                      <select value={c.reasoning ?? ''} onChange={(e) => patchCli(i, { reasoning: e.target.value })} className={cliInput + ' w-28 shrink-0'} title="思考/推理等级">
                        <option value="">思考:默认</option>
                        <option value="minimal">minimal</option>
                        <option value="low">low</option>
                        <option value="medium">medium</option>
                        <option value="high">high</option>
                        <option value="max">max</option>
                      </select>
                    </div>
                    <input value={c.baseUrl ?? ''} onChange={(e) => patchCli(i, { baseUrl: e.target.value })} placeholder="Base URL 覆盖(可选)" className={cliInput + ' w-full'} />
                  </div>
                ))}
              </div>
              <button
                onClick={addCli}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line py-2 text-[13px] text-ink-soft hover:bg-panel"
              >
                <Plus size={15} /> 添加 CLI agent
              </button>
              <div className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
                需先在本机安装并登录对应 CLI(如 <code>codex login</code> / <code>opencode auth</code>)。在输入框上方的下拉里切换 API / CLI。
              </div>
            </div>

            <div className="mt-6 border-t border-line pt-4">
              <button
                onClick={() => updateSettings({ verify: settings.verify === false })}
                className="flex w-full items-center justify-between rounded-lg border border-line bg-white px-3 py-2.5"
              >
                <span className="text-left">
                  <span className="block text-[13.5px] font-medium text-ink">生成后自检</span>
                  <span className="block text-[11.5px] text-ink-faint">
                    完成后自动渲染检查（报错/空白/溢出/坏链）并截图给 AI 视觉自查，有问题先修再交付
                  </span>
                </span>
                <span
                  className={
                    'relative h-6 w-10 shrink-0 rounded-full transition-colors ' +
                    (settings.verify !== false ? 'bg-coral' : 'bg-line-strong')
                  }
                >
                  <span
                    className={
                      'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ' +
                      (settings.verify !== false ? 'left-[18px]' : 'left-0.5')
                    }
                  />
                </span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
