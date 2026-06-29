// IPC bridge: the renderer asks main to run the agent; main streams events back.
// The agent loop (pi-agent-core + native pi-ai) runs here in Node — the whole
// point of the Electron move. verify() round-trips to the renderer (needs DOM).
const { ipcMain, app, BrowserWindow } = require('electron')
const path = require('node:path')
const fsp = require('node:fs/promises')
const { runCliAgent, listModels, generateDesignSystemCli } = require('./cli-agent.cjs')

// A persistent per-project working dir under app data, so a CLI session's file view
// stays consistent across turns (needed for capture-style session resume).
function cliWorkDir(projectId) {
  const safe = String(projectId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(app.getPath('userData'), 'cli-workdirs', safe)
}

let bundlePromise = null
function loadBundle() {
  // agent.bundle.mjs is ESM; require() can't load it — use dynamic import.
  if (!bundlePromise) bundlePromise = import('./agent.bundle.mjs')
  return bundlePromise
}

// Extract a site's design tokens by loading it in a hidden window and reading the
// COMPUTED styles (more accurate than parsing raw/minified CSS) — colors, fonts,
// radii, title, and a copy sample for the design-system generator.
const EXTRACT_JS = `(() => {
  const toHex = (c) => {
    const m = c && c.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
    if (!m) return null;
    return '#' + [m[1],m[2],m[3]].map(x => (+x).toString(16).padStart(2,'0')).join('');
  };
  const els = Array.from(document.querySelectorAll('body *')).slice(0, 5000);
  const bg = {}, fg = {}, rad = {};
  for (const el of els) {
    const cs = getComputedStyle(el);
    if (cs.backgroundColor && cs.backgroundColor.indexOf('rgba(0, 0, 0, 0)') < 0) { const b = toHex(cs.backgroundColor); if (b) bg[b] = (bg[b]||0)+1; }
    const f = toHex(cs.color); if (f) fg[f] = (fg[f]||0)+1;
    const r = parseFloat(cs.borderTopLeftRadius) || 0; if (r > 0 && r < 60) { const k = Math.round(r); rad[k] = (rad[k]||0)+1; }
  }
  const top = (m,n) => Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([k])=>k);
  const h = document.querySelector('h1,h2,h3');
  const body = getComputedStyle(document.body);
  return {
    title: document.title || '',
    bgColors: top(bg,8),
    textColors: top(fg,6),
    radii: top(rad,4).map(Number),
    bodyFont: body.fontFamily,
    headingFont: h ? getComputedStyle(h).fontFamily : body.fontFamily,
    sampleText: (document.body.innerText || '').replace(/\\s+/g,' ').trim().slice(0,1200),
  };
})()`

async function extractSite(url) {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { javascript: true, images: true, sandbox: true, contextIsolation: true },
  })
  try {
    await Promise.race([
      win.loadURL(url),
      new Promise((_, rej) => setTimeout(() => rej(new Error('load timeout')), 20000)),
    ])
    await new Promise((r) => setTimeout(r, 700)) // let late styles/fonts settle
    return await win.webContents.executeJavaScript(EXTRACT_JS, true)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

const aborters = new Map() // webContents.id -> AbortController
const pendingVerify = new Map() // verifyId -> resolve
let verifySeq = 0

function registerAgentIpc() {
  ipcMain.on('agent:stop', (_e, runId) => {
    const ac = aborters.get(runId)
    if (ac) ac.abort()
  })

  // Generate a design system from a URL (crawl computed styles) and/or a text brief.
  ipcMain.handle('ds:generate', async (_e, payload) => {
    try {
      let extracted = {}
      if (payload && payload.url) {
        try {
          extracted = await extractSite(payload.url)
        } catch {
          extracted = {} // site unreachable — let the CLI fetch it, or fall back to text-only
        }
      }
      const input = { url: payload.url, text: payload.text, ...extracted }
      // Route through the active agent: CLI mode uses opencode/codex (it can web-fetch
      // and isn't bottlenecked on the API model); API mode uses the model directly.
      let ds
      if (payload && payload.mode === 'cli' && payload.cfg) {
        ds = await generateDesignSystemCli(payload.cfg, input)
      } else {
        const { generateDesignSystem } = await loadBundle()
        ds = await generateDesignSystem(payload.model, input)
      }
      return { ok: true, ds }
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) }
    }
  })

  // Remove a project's CLI working dir (+ stored session) when the project is deleted.
  ipcMain.handle('cli:cleanup', async (_e, projectId) => {
    try {
      await fsp.rm(cliWorkDir(projectId), { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  // List a CLI's available models (for the settings dropdown).
  ipcMain.handle('cli:models', async (_e, cfg) => {
    try {
      return await listModels(cfg)
    } catch {
      return []
    }
  })

  // CLI mode: spawn a coding CLI (codex/opencode) instead of the API agent loop.
  ipcMain.handle('cli:run', async (e, payload) => {
    const sender = e.sender
    const runId = payload.runId
    const ac = new AbortController()
    aborters.set(runId, ac)
    // Tag every event with the run id so concurrent runs (e.g. two projects in flight)
    // never cross-contaminate — each renderer subscriber only handles its own run.
    const send = (type, data) => {
      if (!sender.isDestroyed()) sender.send('agent:event', { runId, type, data })
    }
    try {
      await runCliAgent({
        cfg: payload.cfg,
        prompt: payload.prompt,
        brief: payload.brief,
        designSystem: payload.designSystem,
        workDir: cliWorkDir(payload.projectId),
        baseMessages: payload.baseMessages || [],
        files: payload.files || [],
        emit: {
          messages: (m) => send('messages', m),
          files: (f) => send('files', f),
          status: (s) => send('status', s),
          toolStream: (t) => send('toolStream', t),
        },
        signal: ac.signal,
      })
      return { ok: true }
    } catch (err) {
      send('error', String((err && err.message) || err))
      return { ok: false, error: String((err && err.message) || err) }
    } finally {
      aborters.delete(runId)
      send('end', null)
    }
  })

  ipcMain.on('agent:verify-result', (_e, { id, result }) => {
    const resolve = pendingVerify.get(id)
    if (resolve) {
      pendingVerify.delete(id)
      resolve(result || { problems: [] })
    }
  })

  ipcMain.handle('agent:run', async (e, payload) => {
    const sender = e.sender
    const runId = payload.runId
    const { runAgent } = await loadBundle()
    const ac = new AbortController()
    aborters.set(runId, ac)

    const send = (type, data) => {
      if (!sender.isDestroyed()) sender.send('agent:event', { runId, type, data })
    }
    const emit = {
      messages: (m) => send('messages', m),
      files: (f) => send('files', f),
      status: (s) => send('status', s),
      toolStream: (t) => send('toolStream', t),
      selectFile: (p) => send('selectFile', p),
    }
    const verify = payload.wantVerify
      ? (path, files) =>
          new Promise((resolve) => {
            const id = String(++verifySeq)
            pendingVerify.set(id, resolve)
            send('verify-request', { id, path, files })
            setTimeout(() => {
              if (pendingVerify.delete(id)) resolve({ problems: [] })
            }, 25000)
          })
      : undefined

    try {
      await runAgent({
        project: payload.project,
        settings: payload.settings,
        systemPrompt: payload.systemPrompt,
        baseMessages: payload.baseMessages,
        emit,
        verify,
        signal: ac.signal,
      })
      return { ok: true }
    } catch (err) {
      send('error', String((err && err.message) || err))
      return { ok: false, error: String((err && err.message) || err) }
    } finally {
      aborters.delete(runId)
      send('end', null)
    }
  })
}

module.exports = { registerAgentIpc }
