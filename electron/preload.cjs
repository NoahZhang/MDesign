// Preload bridge: exposes the main-process agent runtime to the renderer.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mdesign', {
  platform: process.platform,
  isElectron: true,
  agent: {
    // Start a run in main. Resolves when the run ends.
    run: (payload) => ipcRenderer.invoke('agent:run', payload),
    // Start a CLI-agent run (codex/opencode) in main.
    runCli: (payload) => ipcRenderer.invoke('cli:run', payload),
    // List a CLI's available models (for the settings dropdown).
    cliModels: (cfg) => ipcRenderer.invoke('cli:models', cfg),
    // Remove a project's CLI working dir + session on project deletion.
    cliCleanup: (projectId) => ipcRenderer.invoke('cli:cleanup', projectId),
    // Generate a design system from a URL and/or text brief (crawls computed styles).
    generateDesignSystem: (payload) => ipcRenderer.invoke('ds:generate', payload),
    stop: (runId) => ipcRenderer.send('agent:stop', runId),
    // Subscribe to streamed run events; returns an unsubscribe fn.
    onEvent: (cb) => {
      const h = (_e, ev) => cb(ev)
      ipcRenderer.on('agent:event', h)
      return () => ipcRenderer.removeListener('agent:event', h)
    },
    // Reply to a main→renderer verify request.
    sendVerifyResult: (id, result) => ipcRenderer.send('agent:verify-result', { id, result }),
  },
})
