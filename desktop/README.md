# MDesign — native macOS app (Rust)

A self-contained desktop build of MDesign. No Node runtime needed: the React
frontend (`../dist`) is embedded into the binary, and a small Rust HTTP server
inside the app reproduces what the Vite dev server provided:

- `/api/*` → SQLite persistence (rusqlite), same schema as `server/apiPlugin.ts`
- `/llm/*` → reverse proxy to Anthropic / OpenAI / Volcengine Ark
- everything else → the embedded SPA

The native window is `tao` + `wry` (WKWebView) pointed at the local server.

## Build

```bash
desktop/bundle.sh
```

Produces:
- `desktop/MDesign.app` — double-click to run
- `desktop/MDesign.dmg` — drag-to-Applications installer

The script runs `npm run build`, compiles the release binary, generates the
`.icns` from `desktop/icon1024.png`, assembles the bundle, ad-hoc codesigns it,
and creates the dmg. Target arch is whatever the host cargo targets (Apple
Silicon → arm64).

## Run during development

```bash
cargo run --manifest-path desktop/Cargo.toml
```

Env hooks (used by the smoke tests):
- `MDESIGN_PORT=8794` — bind the local server to a fixed port (default: ephemeral)
- `MDESIGN_HEADLESS=1` — run the server only, skip the window

## Data location

User data lives at:

```
~/Library/Application Support/MDesign/app.db
```

(WAL-mode SQLite — projects, files, chat history, and model configs.)

## Notes

- Models are configured inside the app (首页 → 模型配置); none are bundled.
- The app is ad-hoc signed. Built locally it opens directly; if copied via the
  dmg from another machine, first launch may need right-click → Open.
