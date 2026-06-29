// MDesign Electron main process.
// Stage 0: window + backend wiring. The agent runtime (Stage 1) will live here in Node.
//
// Two backend modes:
//  - Dev:  load the Vite dev server (MDESIGN_DEV_URL, default http://localhost:5173).
//          Vite's apiPlugin serves /api and proxies /llm — no Rust needed.
//  - Prod: spawn the Rust binary in headless server mode; it serves the embedded
//          frontend + /api + /__pdf. We parse its stderr for the chosen port.
const { app, BrowserWindow, shell, Notification } = require('electron')
const { spawn } = require('node:child_process')
const path = require('node:path')
const { registerAgentIpc } = require('./agent-ipc.cjs')

// Last-resort guards: a stray async error (e.g. a child-process hiccup) should be
// logged, not crash the whole app with an uncaught-exception dialog.
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e))
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e))

let rustProc = null
/** @type {BrowserWindow | null} */
let win = null

const DEV_URL = process.env.MDESIGN_DEV_URL || (process.env.ELECTRON_DEV ? 'http://localhost:5173' : null)

function rustBinaryPath() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'mdesign')
  return path.join(__dirname, '..', 'desktop', 'target', 'release', 'mdesign')
}

// Spawn the Rust sidecar headless and resolve once it prints its listen URL.
function startRustSidecar() {
  return new Promise((resolve, reject) => {
    const bin = rustBinaryPath()
    rustProc = spawn(bin, [], {
      env: { ...process.env, MDESIGN_HEADLESS: '1', MDESIGN_PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let settled = false
    const onLine = (buf) => {
      const s = String(buf)
      const m = s.match(/http:\/\/127\.0\.0\.1:\d+\/?/)
      if (m && !settled) {
        settled = true
        resolve(m[0].replace(/\/?$/, '/'))
      }
    }
    rustProc.stdout.on('data', onLine)
    rustProc.stderr.on('data', onLine)
    rustProc.on('error', (e) => !settled && (settled = true, reject(e)))
    rustProc.on('exit', (code) => {
      if (!settled) {
        settled = true
        reject(new Error(`Rust sidecar exited (${code}) before reporting a port`))
      }
    })
    setTimeout(() => !settled && (settled = true, reject(new Error('Rust sidecar start timeout'))), 10000)
  })
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 600,
    title: 'MDesign',
    backgroundColor: '#ffffff',
    show: !(process.env.MDESIGN_SMOKE || process.env.MDESIGN_AGENT_SMOKE || process.env.MDESIGN_DL_SMOKE || process.env.MDESIGN_ASK_SMOKE || process.env.MDESIGN_CLI_SMOKE),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // External links open in the system browser, never navigate the app away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Blob/anchor downloads (project zip, .pptx, screenshots) → ~/Downloads, no dialog
  // (replaces the wry INIT_JS download interceptor, which Electron doesn't inject).
  // Notify on completion so the save isn't silent (users couldn't tell it worked).
  win.webContents.session.on('will-download', (_e, item) => {
    const name = item.getFilename()
    try {
      item.setSavePath(path.join(app.getPath('downloads'), name))
    } catch {
      /* fall back to Electron's default save flow */
    }
    item.once('done', (_ev, state) => {
      try {
        new Notification({
          title: 'MDesign',
          body: state === 'completed' ? `已保存到「下载」文件夹：${name}` : `下载失败：${name}`,
        }).show()
      } catch {
        /* notifications best-effort */
      }
    })
  })

  // Navigation safety net (restores wry's nav_policy). The preview iframe swaps
  // content via srcdoc — it should never perform a real frame navigation. Cancel
  // any (a stray link/JS nav would blank the preview); send external links to the
  // browser. The app's own localhost frame and srcdoc/data/blob loads pass through.
  win.webContents.on('will-frame-navigate', (e) => {
    const url = e.url || ''
    if (url.startsWith('about:') || url.startsWith('data:') || url.startsWith('blob:')) return
    const isLocal = /^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url)
    if (e.isMainFrame && isLocal) return
    e.preventDefault()
    if (/^https?:/i.test(url) && !isLocal) shell.openExternal(url)
  })

  const url = DEV_URL || (await startRustSidecar())
  await win.loadURL(url)
  if (process.env.MDESIGN_OPEN_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' })

  // CLI-agent self-test: drive the cli:run IPC (codex) from the renderer and report
  // the files it produced + assistant text.
  if (process.env.MDESIGN_CLI_SMOKE) {
    try {
      await new Promise((r) => setTimeout(r, 1200))
      const kind = JSON.stringify(process.env.CLI_KIND || 'codex')
      const out = await win.webContents.executeJavaScript(`(async () => {
        const cfg = { id:'c1', name:'Codex', kind:${kind}, command:${kind} }
        const files = {}
        let text = ''
        const off = window.mdesign.agent.onEvent((ev) => {
          if (ev.type==='files') for (const f of ev.data) files[f.path]=f.content
          if (ev.type==='messages') { const a=ev.data.find(m=>m.role==='assistant'); const t=a&&a.content&&a.content.find(b=>b.type==='text'); if (t) text=t.text }
        })
        await window.mdesign.agent.runCli({ cfg, prompt:'创建 cli.html,一个写着 CLIOK 的 h1,极简。直接创建不要问。', baseMessages:[{role:'user',content:'建 cli.html'}], files:[] })
        off()
        return { files: Object.keys(files), text: text.slice(0,60) }
      })()`)
      console.log('CLISMOKE:' + JSON.stringify(out))
    } catch (e) {
      console.log('CLISMOKE:error:' + (e && e.message))
    }
    app.quit()
    return
  }

  // ask_questions self-test: force the model to call ask_questions and confirm the
  // streamed transcript carries the tool call + sentinel result (so the form renders).
  if (process.env.MDESIGN_ASK_SMOKE) {
    try {
      await new Promise((r) => setTimeout(r, 1500))
      const key = JSON.stringify(process.env.ARK_KEY || '')
      const out = await win.webContents.executeJavaScript(`(async () => {
        const settings = { models:[{id:'m1',name:'ark',api:'anthropic',model:'ark-code-latest',apiKey:${key},baseUrl:'/llm/ark/api/coding'}], activeId:'m1', promptMode:'condensed', verify:false }
        const project = { id:'asksmoke', name:'Ask', category:'Prototype', role:'Owner', createdAt:1, updatedAt:1, files:[], messages:[] }
        const base = [{ role:'user', content:'我想要一个落地页。动手前你必须先调用 ask_questions 工具问我1个澄清问题(给2-3个选项),不要直接创建文件。' }]
        let msgs = []
        const off = window.mdesign.agent.onEvent((ev) => { if (ev.type==='messages') msgs = ev.data })
        await window.mdesign.agent.run({ project, settings, systemPrompt:'You are a designer. When the brief is ambiguous, call ask_questions BEFORE building. Here you MUST call ask_questions first.', baseMessages: base, wantVerify:false })
        off()
        const hasAskCall = msgs.some(m=>m.role==='assistant' && (m.content||[]).some(b=>b.type==='toolCall'&&b.name==='ask_questions'))
        const hasSentinel = msgs.some(m=>m.role==='toolResult' && m.toolName==='ask_questions' && String(m.content).includes('Awaiting user answers'))
        return { hasAskCall, hasSentinel }
      })()`)
      console.log('ASKSMOKE:' + JSON.stringify(out))
    } catch (e) {
      console.log('ASKSMOKE:error:' + (e && e.message))
    }
    app.quit()
    return
  }

  // Download self-test: trigger a blob/anchor download and confirm will-download
  // lands it in ~/Downloads.
  if (process.env.MDESIGN_DL_SMOKE) {
    const fs = require('node:fs')
    const dest = path.join(app.getPath('downloads'), 'mdesign_dl_test.txt')
    try { fs.unlinkSync(dest) } catch {}
    try {
      await new Promise((r) => setTimeout(r, 1200))
      await win.webContents.executeJavaScript(
        "(()=>{const b=new Blob(['hello-electron-download'],{type:'text/plain'});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download='mdesign_dl_test.txt';document.body.appendChild(a);a.click();a.remove();})()",
      )
      await new Promise((r) => setTimeout(r, 2500))
      console.log('DLSMOKE:' + (fs.existsSync(dest) ? 'ok:' + fs.readFileSync(dest, 'utf8') : 'missing'))
      try { fs.unlinkSync(dest) } catch {}
    } catch (e) {
      console.log('DLSMOKE:error:' + (e && e.message))
    }
    app.quit()
    return
  }

  // Full-path self-test: drive the real agent IPC from the renderer (preload →
  // IPC → main agent loop → events back) and report files produced.
  if (process.env.MDESIGN_AGENT_SMOKE) {
    try {
      await new Promise((r) => setTimeout(r, 1500))
      const key = JSON.stringify(process.env.ARK_KEY || '')
      const out = await win.webContents.executeJavaScript(`(async () => {
        const settings = { models:[{id:'m1',name:'ark',api:'anthropic',model:'ark-code-latest',apiKey:${key},baseUrl:'/llm/ark/api/coding'}], activeId:'m1', promptMode:'condensed', verify:false }
        const project = { id:'smoke', name:'Smoke', category:'Prototype', role:'Owner', createdAt:1, updatedAt:1, files:[], messages:[] }
        const base = [{ role:'user', content:'创建 smoke.html,body 一个写 OK 的 h1。写完调用 done(path=smoke.html)。不要提问。' }]
        const files = {}
        let verified = false, shotShown = false
        const tsLens = new Set()
        const off = window.mdesign.agent.onEvent((ev) => {
          if (ev.type==='files') for (const f of ev.data) files[f.path]=f.content
          if (ev.type==='verify-request') verified = true
          if (ev.type==='toolStream' && ev.data && ev.data.name==='write_file') tsLens.add(ev.data.argsText.length)
          if (ev.type==='messages') for (const m of ev.data) if (m.role==='user' && Array.isArray(m.content) && m.content.some(b=>b.type==='image')) shotShown = true
        })
        await window.mdesign.agent.run({ project, settings, systemPrompt:'You are a designer. Build the file with write_file then call done. No questions.', baseMessages: base, wantVerify: ${process.env.MDESIGN_VERIFY ? 'true' : 'false'} })
        off()
        return { files: Object.keys(files), verified, streamFrames: tsLens.size, shotShown }
      })()`)
      console.log('AGENTSMOKE:' + JSON.stringify(out))
    } catch (e) {
      console.log('AGENTSMOKE:error:' + (e && e.message))
    }
    app.quit()
    return
  }

  // Headless self-test: confirm the SPA mounted, report, and quit.
  if (process.env.MDESIGN_SMOKE) {
    try {
      await new Promise((r) => setTimeout(r, 1500))
      const ok = await win.webContents.executeJavaScript(
        "(()=>{const r=document.getElementById('root');return !!(r&&r.children.length>0);})()",
      )
      console.log('SMOKE:' + (ok ? 'ok' : 'empty'))
    } catch (e) {
      console.log('SMOKE:error:' + (e && e.message))
    }
    app.quit()
    return
  }

  win.on('closed', () => {
    win = null
  })
}

app.whenReady().then(() => {
  registerAgentIpc()
  createWindow()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('quit', () => {
  if (rustProc && !rustProc.killed) rustProc.kill()
})
