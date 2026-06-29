# MDesign

A desktop design workspace where an AI agent builds **real, runnable UI** — prototypes,
pages, components, slide decks — as HTML/JSX files inside a project, with a live preview on
the right. Inspired by the Claude Design workflow.

It ships as an **Electron app** (Chromium renderer + Node main process) with a small **Rust
sidecar** for storage and native PDF extraction. The agent can run two ways:

- **API mode** — an in-process agent loop ([`pi-agent-core`](https://github.com/earendil-works/pi)
  + `pi-ai`) talks directly to a model (Anthropic- or OpenAI-protocol, e.g. Volcengine Ark / GLM).
- **CLI mode** — drives a local coding CLI (**codex / opencode / claude code**) as a child
  process, with native session resume.

Both modes stream messages + files live, ask clarifying questions as a selectable form,
apply a design system consistently, and run a post-generation self-check.

---

## Quick start

```bash
npm install

# Web/dev (browser, fastest iteration — agent runs in-page via a dev proxy)
npm run dev            # http://localhost:5173

# Desktop (Electron) against the dev server
npm run electron:dev

# Build & package a macOS .dmg (frontend + agent bundle + Rust sidecar)
npm run dist:mac       # → electron-dist/MDesign-<ver>-arm64.dmg
```

**Requirements:** Node 18+, npm. For `dist:mac`: Rust/Cargo (the sidecar) and Xcode CLT.
For **CLI mode**: the chosen CLI installed and logged in locally — `codex` (`codex login`),
`opencode` (`opencode auth`), or `claude` (`claude` / setup-token).

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server (browser; agent via dev proxy) |
| `npm run build` | `tsc --noEmit` + Vite production build |
| `npm run build:agent` | Bundle `src/agent-main` → `electron/agent.bundle.mjs` (esbuild) |
| `npm run build:sidecar` | `cargo build --release` the Rust sidecar |
| `npm run electron` / `electron:dev` | Run the packaged renderer / dev renderer in Electron |
| `npm run dist:mac` | Full build + agent bundle + sidecar + `electron-builder --mac` |

---

## Architecture

```
electron/                 ← Electron main process (Node)
  main.cjs                spawns the Rust sidecar, loads the UI, downloads, nav policy
  preload.cjs             window.mdesign bridge (agent run/stop/events)
  agent-ipc.cjs           IPC: agent:run (API) · cli:run (CLI) · ds:generate · cli:models
  cli-agent.cjs           CLI adapters (codex/opencode/claude): spawn, parse stream, sync files
  agent.bundle.mjs        ← generated: bundled API agent loop (gitignored)
  afterPack.cjs           ad-hoc codesign so the .app isn't flagged "damaged" on transfer

src/
  agent-main/             ← API-mode agent loop (runs in Electron main, Node)
    run.ts                pi-agent-core loop + compaction + verify + done/screenshot
    transport.ts          app model-config → pi-ai Model + streamFn (direct, no CORS)
    designgen.ts          one-shot "design system from a URL/brief" (API path)
    map.ts                app ⇆ pi-ai message bridging
  agent/                  ← agent assets shared with the browser fallback
    fullPrompt.ts         the bundled Claude Design prompt (claude_design_system_prompt.md)
    systemPrompt.ts       project-context block
    verify.ts             post-generation self-check (renders + reports problems)
  lib/
    useAgentRunner.ts     run lifecycle: API vs CLI routing, ask-questions, CLI self-check
    electronAgent.ts      renderer ⇆ main IPC client (per-run runId isolation)
    designSystem.ts       design system → prompt block + token CSS + font <link>
    designPresets.ts      built-in starter design systems
    store.ts, types.ts, seed.ts, …
  pages/         Gallery.tsx · Workspace.tsx
  components/    gallery/* · workspace/*

desktop/                  ← Rust sidecar (headless server)
  src/main.rs             SQLite (rusqlite) /api, native PDF (PDFKit) /__pdf, static frontend
```

The Electron main process launches the Rust binary in headless mode (`MDESIGN_HEADLESS=1`),
reads the chosen port from its stderr, and points the renderer at it. The renderer talks to
`/api` (state) and `/__pdf` (PDF text); the agent runs in **main** (Node — no browser CORS to
the model gateway).

---

## Agent modes

### API mode
`runAgent` (bundled from `src/agent-main`) runs the `pi-agent-core` loop in Node, streaming
via `pi-ai`. Tools: `write_file`, `read_file`, `list_files`, `str_replace_edit`,
`delete_file`, `ask_questions`, `done`. Context compaction kicks in for long chats; `done`
triggers the self-check (`verify.ts`) and a screenshot for visual review.

### CLI mode
`cli-agent.cjs` drives a local coding CLI:

| CLI | Invocation (fresh) | Resume |
| --- | --- | --- |
| codex | `codex exec --json -s workspace-write -C <dir>` | `codex exec resume <thread_id>` |
| opencode | `opencode run --format json --dir <dir>` | `… -s <sessionID>` |
| claude code | `claude -p … --output-format stream-json --permission-mode bypassPermissions` | `… --resume <session_id>` |

- **Per-project persistent working dir** (`<userData>/cli-workdirs/<projectId>/`): project
  files are materialized there, the CLI edits them, changes sync back live.
- **Capture-style session resume**: the session id is captured from the stream and reused on
  the next turn, so follow-ups continue the same native session (no re-flattening the
  transcript).
- **Per-run `runId` isolation** so two projects in flight never cross-contaminate.
- A **post-generation self-check** runs `verify.ts` on the deliverable and resumes the CLI to
  fix any problems (bounded).
- Per-CLI **proxy / model / reasoning / base-URL** are configurable in Settings.

---

## Design systems

A design system is a rich, agent-readable **`DESIGN.md`** spec (atmosphere, color & roles,
type scale, components, spacing, elevation, do/don'ts, responsive, voice) plus token fields
(colors, fonts, radius) that compile to a `:root` block + a Google-Fonts `<link>`.

- **Built-in presets:** Apple, 极简留白, 专业商务, 活力现代, 暗色科技.
- **Generate from a URL or a one-line brief:** Settings → design systems → ✨ — Electron
  crawls the site's computed styles (or the active CLI web-fetches it) and the model produces
  a full system.
- **Pick per project** from the composer (or follow the default / none).
- **No brand pinned?** The agent still establishes one coherent system derived from the
  user's clarifying-question answers and the brief, encoded as CSS variables and reused across
  every page (distilled from Anthropic's *frontend-design* guidance).

---

## Configuration

- **API mode model:** add a model config in the app (provider, model id, API key, base URL).
  A default Ark/GLM key may be read from **`.env.local`** as `VITE_ARK_API_KEY`
  (**gitignored** — never committed).
- **CLI mode:** add a CLI agent (codex / opencode / claude) in Settings; it uses your local
  login unless you set a base URL / key / proxy.
- **Storage:** SQLite at `~/Library/Application Support/MDesign/app.db` (desktop) or
  `data/app.db` (dev). Delete it to reset.

---

## Packaging notes

`dist:mac` produces an **ad-hoc-signed** `.app`/`.dmg` (no Apple Developer cert). On another
Mac the file is quarantined on transfer, so recipients open it once via **right-click → Open**,
or clear the quarantine: `xattr -cr /Applications/MDesign.app`. Zero-warning distribution
requires Developer ID signing + notarization.
