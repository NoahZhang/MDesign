// CLI-agent mode (separate from API mode): drive a local coding CLI (codex / opencode)
// as a child process. Flow: materialize the project's files to a temp dir → spawn the
// CLI there (with proxy/baseUrl env) → parse its JSONL event stream into chat text +
// tool chips → read the (edited) files back → emit messages/files/status over IPC.
const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

// A GUI-launched macOS app inherits a minimal PATH — not just missing codex/opencode,
// but also `node` (which codex needs at startup → "env: node: No such file or
// directory", exit 127). Capture the user's real login-shell PATH once; that has
// everything (node, codex, opencode), wherever a version manager put it.
let _loginPath = null
function loginShellPath() {
  if (_loginPath !== null) return _loginPath
  _loginPath = ''
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const out = execFileSync(shell, ['-lic', 'echo MDPATH=$PATH'], { encoding: 'utf8', timeout: 6000 })
    const line = out.split('\n').find((l) => l.startsWith('MDPATH='))
    if (line) _loginPath = line.slice('MDPATH='.length).trim()
  } catch {
    _loginPath = ''
  }
  return _loginPath
}

function augmentedPath() {
  const home = os.homedir()
  const extra = [
    '/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin',
    path.join(home, '.bun/bin'), path.join(home, '.cargo/bin'), path.join(home, '.local/bin'),
    path.join(home, '.npm-global/bin'), path.join(home, '.deno/bin'), path.join(home, '.volta/bin'),
    path.join(home, '.nvm/current/bin'), '/opt/local/bin',
  ]
  const login = loginShellPath().split(':').filter(Boolean)
  const cur = (process.env.PATH || '').split(':').filter(Boolean)
  return [...new Set([...extra, ...login, ...cur])].join(':')
}

function resolveCommand(cmd, pathStr) {
  if (cmd.includes('/')) return fs.existsSync(cmd) ? cmd : null
  for (const dir of pathStr.split(':')) {
    const p = path.join(dir, cmd)
    try {
      fs.accessSync(p, fs.constants.X_OK)
      return p
    } catch {
      /* keep looking */
    }
  }
  return null
}

function contentTypeFor(p) {
  const ext = (p.split('.').pop() || '').toLowerCase()
  const m = {
    html: 'text/html', htm: 'text/html', jsx: 'text/jsx', tsx: 'text/tsx', js: 'text/javascript',
    ts: 'text/typescript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml',
    md: 'text/markdown', txt: 'text/plain',
  }
  return m[ext] || 'text/plain'
}

// codex has no `models` command (models follow your account); curated fallback list
// for the settings dropdown. Users can still type a custom model (sanitized).
const CODEX_MODELS = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2']

// Claude Code model aliases for the dropdown ('default' = the CLI's configured model).
const CLAUDE_MODELS = ['default', 'sonnet', 'opus', 'haiku']

// Pull a human label (file/command/etc.) out of a Claude tool_use input object.
function claudeToolLabel(input) {
  if (!input || typeof input !== 'object') return ''
  return input.file_path || input.path || input.command || input.pattern || input.url || input.notebook_path || ''
}

// A model/effort value becomes a CLI arg — reject flag-like / overlong / multiline
// strings so a stray value can't be misparsed as a flag.
function safeArg(v) {
  if (v == null) return null
  const s = String(v).trim()
  if (!s || s.length > 200 || s.startsWith('-') || /[\n\r\t]/.test(s)) return null
  return s
}

// ---- adapters: one entry per CLI (build the command + parse a JSONL event) ----
const ADAPTERS = {
  codex: {
    // `codex exec resume <id>` continues a prior session; it rejects `-C`, so the
    // working dir comes from the spawn cwd. Fresh runs use `-s` sandbox + `-C`.
    build(prompt, dir, cfg, sessionId) {
      const args = sessionId
        ? ['exec', 'resume', sessionId, '--json', '--skip-git-repo-check', '-c', 'sandbox_mode="workspace-write"']
        : ['exec', '--json', '--skip-git-repo-check', '-s', 'workspace-write', '-C', dir]
      const m = safeArg(cfg.model)
      if (m) args.push('-m', m)
      const r = safeArg(cfg.reasoning)
      if (r) args.push('-c', `model_reasoning_effort=${r}`)
      args.push(prompt)
      return { cmd: cfg.command || 'codex', args }
    },
    env(cfg, env) {
      if (cfg.baseUrl) env.OPENAI_BASE_URL = cfg.baseUrl
      if (cfg.apiKey) env.OPENAI_API_KEY = cfg.apiKey
    },
    captureSession(o) {
      return o.type === 'thread.started' && o.thread_id ? o.thread_id : null
    },
    parse(o) {
      if (o.type === 'item.completed' && o.item?.type === 'agent_message') return { text: o.item.text }
      if (o.type === 'item.started' && o.item?.type === 'command_execution')
        return { tool: { name: 'bash', label: o.item.command || '' } }
      if (o.type === 'item.completed' && o.item?.type && o.item.type !== 'agent_message' && o.item.type !== 'command_execution')
        return { tool: { name: o.item.type, label: o.item.path || o.item.id || '' } }
      if (o.type === 'turn.completed') return { done: true }
      return {}
    },
  },
  opencode: {
    // `opencode run -s <id>` continues the session it minted (reported as sessionID).
    build(prompt, dir, cfg, sessionId) {
      const args = ['run', '--format', 'json', '--dangerously-skip-permissions', '--dir', dir]
      if (sessionId) args.push('-s', sessionId)
      const m = safeArg(cfg.model)
      if (m) args.push('-m', m)
      const r = safeArg(cfg.reasoning)
      if (r) args.push('--variant', r)
      args.push(prompt)
      return { cmd: cfg.command || 'opencode', args }
    },
    env(cfg, env) {
      if (cfg.baseUrl) env.OPENCODE_BASE_URL = cfg.baseUrl
      if (cfg.apiKey) env.OPENCODE_API_KEY = cfg.apiKey
    },
    captureSession(o) {
      return o.sessionID || o.part?.sessionID || null
    },
    parse(o) {
      if (o.type === 'text' && o.part?.text) return { text: o.part.text }
      if (o.type === 'tool_use' && o.part?.tool) {
        const inp = o.part.state?.input || {}
        return { tool: { name: o.part.tool, label: inp.filePath || inp.path || inp.command || '' } }
      }
      return {}
    },
  },
  claude: {
    // Claude Code: `claude -p <prompt> --output-format stream-json` (resume via --resume).
    build(prompt, dir, cfg, sessionId) {
      const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions', '--add-dir', dir]
      if (sessionId) args.push('--resume', sessionId)
      const m = safeArg(cfg.model)
      if (m && m !== 'default') args.push('--model', m)
      return { cmd: cfg.command || 'claude', args }
    },
    env(cfg, env) {
      if (cfg.baseUrl) env.ANTHROPIC_BASE_URL = cfg.baseUrl
      if (cfg.apiKey) env.ANTHROPIC_API_KEY = cfg.apiKey
    },
    captureSession(o) {
      return o.type === 'system' && o.subtype === 'init' && o.session_id ? o.session_id : null
    },
    // One assistant event can carry several content blocks (text + tool_use) → array.
    parse(o) {
      if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
        const out = []
        for (const b of o.message.content) {
          if (b.type === 'text' && b.text) out.push({ text: b.text })
          else if (b.type === 'tool_use') out.push({ tool: { name: b.name || 'tool', label: claudeToolLabel(b.input) } })
        }
        return out
      }
      if (o.type === 'result') return { done: true }
      return {}
    },
  },
}

// Parse a fenced ```ask { ...QuestionSpec... } ``` block the agent emits when it
// wants to clarify — so we can render the same selectable form API mode uses.
function parseAskBlock(text) {
  const m = String(text || '').match(/```ask\s*([\s\S]*?)```/)
  if (!m) return null
  try {
    const spec = JSON.parse(m[1].trim())
    if (spec && Array.isArray(spec.questions) && spec.questions.length) {
      return { spec, stripped: String(text).replace(m[0], '').trim() }
    }
  } catch {
    /* not valid JSON — ignore */
  }
  return null
}

// Recursively read text files from the working dir (skip vcs/deps/dotfiles).
async function readDirFiles(dir) {
  const out = []
  async function walk(rel) {
    const abs = path.join(dir, rel)
    for (const ent of await fsp.readdir(abs, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || ent.name === 'node_modules') continue
      const r = rel ? `${rel}/${ent.name}` : ent.name
      if (ent.isDirectory()) await walk(r)
      else if (ent.isFile()) {
        try {
          const st = await fsp.stat(path.join(dir, r))
          if (st.size > 2_000_000) continue // skip big/binary artifacts
          out.push({
            path: r,
            content: await fsp.readFile(path.join(dir, r), 'utf8'),
            contentType: contentTypeFor(r),
            updatedAt: Math.round(st.mtimeMs) || Date.now(),
          })
        } catch {
          /* skip unreadable */
        }
      }
    }
  }
  await walk('')
  return out
}

// Run a CLI once and collect only its assistant text (structuring fallback + design-gen).
function runCollect(resolved, args, env, dir, adapter, signal, timeoutMs = 60000) {
  return new Promise((resolve) => {
    let text = ''
    let buf = ''
    const p = spawn(resolved, args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
    const onAbort = () => {
      try {
        p.kill()
      } catch {
        /* ignore */
      }
    }
    signal?.addEventListener('abort', onAbort)
    p.stdout.on('data', (d) => {
      buf += d.toString()
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line || line[0] !== '{') continue
        let o
        try {
          o = JSON.parse(line)
        } catch {
          continue
        }
        const parsed = adapter.parse(o)
        for (const r of Array.isArray(parsed) ? parsed : [parsed]) if (r.text) text += (text ? '\n\n' : '') + r.text
      }
    })
    const done = () => {
      signal?.removeEventListener('abort', onAbort)
      resolve(text)
    }
    p.on('error', done)
    p.on('exit', done)
    setTimeout(() => {
      onAbort()
      done()
    }, timeoutMs)
  })
}

/**
 * Run a CLI agent. `emit` mirrors the API path: messages (full transcript, app DTO),
 * files (project snapshot), status, toolStream.
 *
 * Multi-turn continuity (open-design's "capture-style resume"): the CLI mints a
 * session id (codex `thread.started.thread_id`, opencode `sessionID`) which we capture
 * from the stream and store per project in `<workDir>/.mdesign-session.json`. On a
 * follow-up we resume that session (codex `exec resume <id>`, opencode `-s <id>`) and
 * send only the new message — the CLI keeps the context, so we don't re-flatten the
 * transcript. `workDir` is a persistent per-project dir so the session's file view stays
 * consistent across runs.
 */
async function runCliAgent({ cfg, prompt, brief, designSystem, baseMessages, files, emit, signal, workDir }) {
  const adapter = ADAPTERS[cfg.kind]
  if (!adapter) throw new Error(`Unknown CLI agent: ${cfg.kind}`)
  const persistent = !!workDir
  const dir = workDir || (await fsp.mkdtemp(path.join(os.tmpdir(), 'mdesign-cli-')))
  const home = os.homedir()
  const sessionFile = path.join(dir, '.mdesign-session.json')
  try {
    await fsp.mkdir(dir, { recursive: true })
    // Materialize the project's current files (the store is the source of truth each run).
    const original = new Set(files.map((f) => f.path))
    for (const f of files) {
      const fp = path.join(dir, f.path)
      await fsp.mkdir(path.dirname(fp), { recursive: true })
      await fsp.writeFile(fp, f.content ?? '')
    }

    // Inject the MDesign design guidance as AGENTS.md (codex/opencode auto-read it).
    const injected = new Set()
    if (brief && brief.trim()) {
      if (!original.has('AGENTS.md')) injected.add('AGENTS.md')
      await fsp.writeFile(path.join(dir, 'AGENTS.md'), brief)
    }
    // The active design system is what the user toggles per-run; inject it into the
    // prompt EVERY turn (not just AGENTS.md) so even a resumed session applies it.
    const dsBlock = designSystem && designSystem.trim() ? designSystem.trim() + '\n\n' : ''
    const freshPrompt =
      dsBlock +
      (brief && brief.trim()
        ? '请先阅读并严格遵循项目根目录的 AGENTS.md(设计规范与本项目要求),以及上面的 Active design system(若有)。\n' +
          '【务必一次做完】不要只汇报计划或中途进度("接下来我会…")就结束回复。请持续工作,直到所有需要的文件都已创建并写完、成品完整可用,然后才结束本次运行。除非需要向用户澄清(见下),否则不要在任务未完成时停下。\n' +
          '【重要·提问格式】若需先澄清需求,**不要用普通文字罗列问题**——必须只输出一个 ```ask 代码块(JSON:{"questions":[{"id":"snake_case","title":"问题","kind":"text-options","options":["选项1","选项2","选项3"],"multi":false}]},每题给 3-5 个具体可选项),输出后立即停止、不要创建文件。\n\n' +
          prompt
        : prompt)
    const resumePrompt =
      dsBlock +
      '【继续上文,同一会话】请接着完成;严格遵循上面的 Active design system(若有);一次做完,任务未完成不要停。若需澄清只输出 ```ask 代码块。\n\n' +
      prompt

    const PATH = augmentedPath()
    const resolved = resolveCommand(cfg.command || cfg.kind, PATH)
    if (!resolved) {
      emit.messages([
        ...baseMessages,
        {
          role: 'assistant',
          content: [{ type: 'text', text: `⚠︎ 找不到可执行的 \`${cfg.command || cfg.kind}\`。请确认已安装,或在「CLI agents」设置里把"可执行命令"填成绝对路径(终端里运行 \`which ${cfg.command || cfg.kind}\` 查看)。` }],
          stopReason: 'error',
        },
      ])
      return
    }
    const env = { ...process.env, PATH }
    if (cfg.proxy) {
      env.HTTPS_PROXY = cfg.proxy; env.HTTP_PROXY = cfg.proxy; env.ALL_PROXY = cfg.proxy
      env.https_proxy = cfg.proxy; env.http_proxy = cfg.proxy; env.all_proxy = cfg.proxy
      env.NO_PROXY = '127.0.0.1,localhost'; env.no_proxy = '127.0.0.1,localhost'
    }
    adapter.env(cfg, env)

    // Stored session id for this project (resume only when the CLI kind matches).
    let resumeId = null
    try {
      const s = JSON.parse(await fsp.readFile(sessionFile, 'utf8'))
      if (s && s.kind === cfg.kind && s.sessionId) resumeId = s.sessionId
    } catch {
      /* none yet */
    }

    // One spawn: parse the stream, stream messages/files/status live, capture the
    // session id. Resolves with the collected result.
    const attempt = (sessionId) =>
      new Promise((resolveAttempt) => {
        const useResume = !!sessionId
        const { args } = adapter.build(useResume ? resumePrompt : freshPrompt, dir, cfg, sessionId)
        let assistantText = ''
        const toolBlocks = []
        let capturedSession = null
        let stderr = ''
        let settled = false
        const emitMsgs = () => {
          const content = []
          if (assistantText) content.push({ type: 'text', text: assistantText })
          for (const t of toolBlocks) content.push(t)
          emit.messages([...baseMessages, { role: 'assistant', content, stopReason: 'end' }])
        }
        emit.status({ kind: 'running', label: (cfg.model || cfg.kind) + (useResume ? ' · 继续' : '') })

        // Live file sync: watch the dir and stream files as the CLI writes them.
        let syncTimer = null
        const liveSync = () => {
          clearTimeout(syncTimer)
          syncTimer = setTimeout(async () => {
            try {
              const cur = (await readDirFiles(dir)).filter((f) => !injected.has(f.path))
              if (cur.length) emit.files(cur)
            } catch {
              /* ignore */
            }
          }, 350)
        }
        let watcher = null
        try {
          watcher = fs.watch(dir, { recursive: true }, () => liveSync())
        } catch {
          /* fall back to end-of-run sync */
        }

        const proc = spawn(resolved, args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
        const onAbort = () => proc.kill()
        signal?.addEventListener('abort', onAbort)
        const cleanup = () => {
          signal?.removeEventListener('abort', onAbort)
          clearTimeout(syncTimer)
          try {
            watcher?.close()
          } catch {
            /* ignore */
          }
          emit.toolStream(null)
        }

        let buf = ''
        proc.stdout.on('data', (d) => {
          buf += d.toString()
          let i
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim()
            buf = buf.slice(i + 1)
            if (!line || line[0] !== '{') continue
            let o
            try {
              o = JSON.parse(line)
            } catch {
              continue
            }
            const sid = adapter.captureSession?.(o)
            if (sid) capturedSession = sid
            const parsed = adapter.parse(o)
            for (const r of Array.isArray(parsed) ? parsed : [parsed]) {
              if (r.text) {
                assistantText += (assistantText ? '\n\n' : '') + r.text
                emitMsgs()
              }
              if (r.tool) {
                toolBlocks.push({ type: 'toolCall', id: `t${toolBlocks.length}`, name: r.tool.name, input: { label: r.tool.label } })
                emit.toolStream({ id: `t${toolBlocks.length}`, name: r.tool.name, argsText: r.tool.label })
                // Live heartbeat: tidy the label — strip the temp workdir prefix (so a
                // write shows "foo.html", not the full Application Support path) and home → ~.
                let lbl = r.tool.label || ''
                if (lbl.startsWith(dir)) lbl = lbl.slice(dir.length).replace(/^\/+/, '')
                else if (lbl.startsWith(home)) lbl = '~' + lbl.slice(home.length)
                const detail = lbl ? `${r.tool.name} · ${lbl}` : r.tool.name
                emit.status({ kind: 'running', label: detail.slice(0, 56) + `  · 第${toolBlocks.length}步` })
                emitMsgs()
              }
            }
          }
        })
        proc.stderr.on('data', (d) => {
          stderr += d.toString()
        })
        proc.on('exit', async (code) => {
          if (settled) return
          settled = true
          cleanup()
          let synced = []
          try {
            synced = (await readDirFiles(dir)).filter((f) => !injected.has(f.path))
            if (synced.length) emit.files(synced)
          } catch {
            /* ignore */
          }
          resolveAttempt({ code: code ?? -1, assistantText, toolBlocks, synced, capturedSession, stderr })
        })
        proc.on('error', (err) => {
          stderr += `\n[spawn error] ${err.message}`
          if (settled) return
          settled = true
          cleanup()
          resolveAttempt({ code: -1, assistantText, toolBlocks, synced: [], capturedSession, stderr })
        })
      })

    // Resume the stored session; if resume fails hard (e.g. expired), retry fresh.
    let result = await attempt(resumeId)
    const failedHard = (r) => r.code !== 0 && !r.assistantText && r.toolBlocks.length === 0 && r.synced.length === 0
    if (resumeId && failedHard(result) && !signal?.aborted) {
      try {
        await fsp.rm(sessionFile, { force: true })
      } catch {
        /* ignore */
      }
      emit.status({ kind: 'running', label: '会话已过期,重新开始…' })
      result = await attempt(null)
    }
    if (result.capturedSession) {
      try {
        await fsp.writeFile(sessionFile, JSON.stringify({ sessionId: result.capturedSession, kind: cfg.kind }))
      } catch {
        /* ignore */
      }
    }

    const { code, assistantText, toolBlocks, synced, stderr } = result
    const emitFinal = (text) => {
      const content = []
      if (text) content.push({ type: 'text', text })
      content.push(...toolBlocks)
      emit.messages([...baseMessages, { role: 'assistant', content, stopReason: 'end' }])
    }

    // ```ask block → the same selectable form API mode uses (synthetic tool call +
    // sentinel). Fallback: the CLI asked in prose → a quick read-only pass structures it.
    let ask = parseAskBlock(assistantText)
    if (!ask && synced.length === 0 && assistantText.length > 10 && /[?？]/.test(assistantText) && !signal?.aborted) {
      try {
        emit.status({ kind: 'running', label: '整理问题…' })
        const structPrompt =
          '把下面这段澄清问题改写成一个 ```ask 代码块,JSON 格式:{"questions":[{"id":"snake_case","title":"问题","kind":"text-options","options":["选项1","选项2","选项3"],"multi":false}]}。每题给 3-5 个具体可选项,保持原问题含义。只输出该 ```ask 代码块,不要任何其它文字:\n\n' +
          assistantText
        const structArgs =
          cfg.kind === 'codex'
            ? ['exec', '--json', '--skip-git-repo-check', '-s', 'read-only', '-C', dir, structPrompt]
            : ['run', '--format', 'json', '--dir', dir, structPrompt]
        const structText = await runCollect(resolved, structArgs, env, dir, adapter, signal)
        const s = parseAskBlock(structText)
        if (s) ask = { spec: s.spec, stripped: assistantText }
      } catch {
        /* keep the prose questions as-is */
      }
    }
    if (ask) {
      const askId = 'ask_' + Math.random().toString(36).slice(2)
      const content = []
      if (ask.stripped) content.push({ type: 'text', text: ask.stripped })
      content.push(...toolBlocks)
      content.push({ type: 'toolCall', id: askId, name: 'ask_questions', input: ask.spec })
      emit.messages([
        ...baseMessages,
        { role: 'assistant', content, stopReason: 'end' },
        { role: 'toolResult', toolCallId: askId, toolName: 'ask_questions', content: 'Awaiting user answers.' },
      ])
    } else if (!assistantText && code !== 0) {
      emitFinal(`⚠︎ ${cfg.model || cfg.kind} 退出（code ${code}）。${stderr.slice(-400)}`)
    } else {
      emitFinal(assistantText)
    }
  } finally {
    emit.status(null)
    if (!persistent) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// List the models a CLI supports (for the settings dropdown). opencode has a real
// `models` command; codex has none (models follow your OpenAI account) → empty.
async function listModels(cfg) {
  if (cfg.kind === 'codex') return CODEX_MODELS
  if (cfg.kind === 'claude') return CLAUDE_MODELS
  const PATH = augmentedPath()
  if (cfg.kind !== 'opencode') return []
  const cmd = resolveCommand(cfg.command || 'opencode', PATH)
  if (!cmd) return []
  const env = { ...process.env, PATH }
  if (cfg.proxy) {
    env.HTTPS_PROXY = cfg.proxy; env.HTTP_PROXY = cfg.proxy; env.ALL_PROXY = cfg.proxy
    env.NO_PROXY = '127.0.0.1,localhost'
  }
  return new Promise((resolve) => {
    let out = ''
    const p = spawn(cmd, ['models'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    p.stdout.on('data', (d) => (out += d.toString()))
    p.on('error', () => resolve([]))
    p.on('exit', () => resolve(out.split('\n').map((s) => s.trim()).filter((s) => s && s.includes('/'))))
    setTimeout(() => {
      try {
        p.kill()
      } catch {
        /* ignore */
      }
      resolve(out.split('\n').map((s) => s.trim()).filter((s) => s && s.includes('/')))
    }, 15000)
  })
}

// ---- Design-system generation via the active CLI (opencode/codex) ----

function buildGenPrompt(input) {
  const lines = []
  if (input.url) lines.push(`Target website: ${input.url}${input.title ? ` — ${input.title}` : ''}`)
  if (input.bgColors && input.bgColors.length) lines.push(`Observed background colors: ${input.bgColors.join(', ')}`)
  if (input.textColors && input.textColors.length) lines.push(`Observed text colors: ${input.textColors.join(', ')}`)
  if (input.radii && input.radii.length) lines.push(`Observed border radii (px): ${input.radii.join(', ')}`)
  if (input.headingFont) lines.push(`Heading font stack: ${input.headingFont}`)
  if (input.bodyFont) lines.push(`Body font stack: ${input.bodyFont}`)
  if (input.sampleText) lines.push(`Sample copy: ${String(input.sampleText).slice(0, 800)}`)
  if (input.text) lines.push(`User intent / notes: ${input.text}`)
  if (!lines.length) lines.push('No site data; design a tasteful modern system from scratch.')
  return (
    `You are a senior brand & design-systems designer. ` +
    (input.url ? `Use your web-fetch tool to read ${input.url} and inspect its real colors, fonts, spacing and components. ` : '') +
    `Analyze the target and distill a reusable design system. DO NOT create or edit any files.\n\n` +
    lines.join('\n') +
    `\n\nReply with ONLY a single \`\`\`json code block (no other prose) of the form:\n` +
    `\`\`\`json\n{"name":"short name","colors":[{"name":"role e.g. bg/surface/text/muted/primary/accent/line","value":"#RRGGBB"}],"headingFont":"OneRealFamily","bodyFont":"OneRealFamily","radius":12,"spec":"a rich DESIGN.md markdown with ## sections: Atmosphere & visual theme; Color & roles; Typography (concrete type scale h1/h2/h3/body with px, weight, line-height, letter-spacing); Spacing & layout; Components (buttons/cards/inputs/badges: bg,text,padding,radius,hover); Depth & elevation; Do & Don't; Responsive; Voice. reference tokens like var(--primary)"}\n\`\`\`\n` +
    `Rules: 4-6 hex color tokens; one REAL font family name each (map system stacks to a Google font like Inter); radius is an integer of px; the spec must be a single valid JSON string (escape newlines). Output the json block only.`
  )
}

// Pull a JSON object out of CLI output (it may wrap it in a ```json fence or prose).
function extractJsonObject(text) {
  let t = String(text || '')
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1]
  const start = t.indexOf('{')
  if (start < 0) throw new Error('CLI did not return JSON')
  let depth = 0
  let inStr = false
  let esc = false
  let end = -1
  for (let i = start; i < t.length; i++) {
    const c = t[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
    } else if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }
  return JSON.parse(end > 0 ? t.slice(start, end) : t.slice(start))
}

function coerceDesignSystem(j, input) {
  const first = (s) =>
    String(s || '')
      .replace(/["']/g, '')
      .split(',')[0]
      .trim()
  const colors = Array.isArray(j.colors)
    ? j.colors
        .filter((c) => c && typeof c.value === 'string' && /^#?[0-9a-fA-F]{3,8}$/.test(String(c.value)))
        .map((c) => ({
          name: String(c.name || 'color'),
          value: String(c.value).startsWith('#') ? String(c.value) : '#' + String(c.value),
        }))
    : []
  return {
    name: String(j.name || (input && input.title) || 'Generated').slice(0, 40),
    colors,
    headingFont: first(j.headingFont) || 'Inter',
    bodyFont: first(j.bodyFont) || first(j.headingFont) || 'Inter',
    radius: Number.isFinite(Number(j.radius)) ? Math.max(0, Math.round(Number(j.radius))) : 12,
    spec: String(j.spec || ''),
  }
}

async function generateDesignSystemCli(cfg, input) {
  const adapter = ADAPTERS[cfg.kind]
  if (!adapter) throw new Error(`Unknown CLI agent: ${cfg.kind}`)
  const PATH = augmentedPath()
  const resolved = resolveCommand(cfg.command || cfg.kind, PATH)
  if (!resolved) throw new Error(`找不到可执行的 ${cfg.command || cfg.kind}`)
  const env = { ...process.env, PATH }
  if (cfg.proxy) {
    env.HTTPS_PROXY = cfg.proxy; env.HTTP_PROXY = cfg.proxy; env.ALL_PROXY = cfg.proxy
    env.https_proxy = cfg.proxy; env.http_proxy = cfg.proxy; env.all_proxy = cfg.proxy
    env.NO_PROXY = '127.0.0.1,localhost'; env.no_proxy = '127.0.0.1,localhost'
  }
  adapter.env(cfg, env)
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdesign-dsgen-'))
  try {
    const prompt = buildGenPrompt(input)
    const args =
      cfg.kind === 'codex'
        ? ['exec', '--json', '--skip-git-repo-check', '-s', 'read-only', '-C', dir, prompt]
        : cfg.kind === 'claude'
          ? ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions', '--add-dir', dir]
          : ['run', '--format', 'json', '--dir', dir, prompt]
    const text = await runCollect(resolved, args, env, dir, adapter, undefined, 180000)
    return coerceDesignSystem(extractJsonObject(text), input)
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

module.exports = {
  runCliAgent,
  listModels,
  generateDesignSystemCli,
  CLI_KINDS: Object.keys(ADAPTERS),
  augmentedPath,
  resolveCommand,
}
