# Claude Design (MDesign)

A project-based design workspace, recreated from the **Claude Design** UI in
`claude_design_system_prompt.md`. Two screens:

- **Gallery** (`/`) — create / search / open projects, grouped as cards with a
  "New project" rail and a "Set up design system" card.
- **Workspace** (`/p/:id`) — a **chat agent on the left**, **Design Files + live
  preview on the right**. When the agent writes a file it appears in the file
  tree immediately and renders in the preview.

The chat is a real **agent** (a tool-using loop), built on a small
provider-agnostic LLM layer that speaks **both the Anthropic and OpenAI
protocols**. The framework is modeled on
[`earendil-works/pi`](https://github.com/earendil-works/pi) — its `pi-ai`
(unified multi-provider LLM API) and `pi-agent-core` (agent runtime with tool
calling + state) package split.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build
```

No API key required: with no key the chat runs a built-in **demo agent** that
still streams a reply and writes a real HTML file into the project. Add a key
in the composer's model menu → *Model settings…* to use a live model.

## Architecture

```
src/
  pi-ai/                      ← provider-agnostic LLM layer (mirrors pi-ai)
    types.ts                  Message / Tool / Context / StreamEvent / Model
    index.ts                  stream(model, context, opts) · complete(...)
    models.ts                 model catalog + resolveModel()
    sse.ts                    shared SSE reader
    adapters/
      anthropic.ts            Anthropic Messages API (streaming + tool_use)
      openai.ts               OpenAI Chat Completions (streaming + tool_calls)
      mock.ts                 offline demo provider (same event vocabulary)
  agent/                      ← agent runtime (mirrors pi-agent-core)
    agent.ts                  runAgent(): stream → run tools → feed back → loop
    tools.ts                  write_file / read_file / list_files /
                              str_replace_edit / delete_file /
                              ask_questions / done
    systemPrompt.ts           condensed Claude Design designer prompt
  lib/
    store.ts                  server-backed store (useSyncExternalStore) + FS ops
    seed.ts, types.ts, format.ts, id.ts
  pages/      Gallery.tsx · Workspace.tsx
  components/ gallery/* · workspace/* · Logo.tsx
```

### How the agent works

1. The user sends a message. `runAgent` builds a `Context`
   `{ systemPrompt, messages, tools }` and calls `stream(model, context)`.
2. Events are normalized to one vocabulary (`text_delta`, `toolcall_end`,
   `done`, …) regardless of provider, so the chat streams live.
3. Each tool call runs against the project's **virtual file system** (the
   localStorage-backed file list). `write_file` → the file shows up in *Design
   Files* and opens in the preview.
4. Tool results are appended and the loop repeats until the model stops asking
   for tools (or calls `done`). Max 8 turns.

`ask_questions` is a **human-in-the-loop** tool: when the model calls it the run
pauses, the chat renders an interactive option form (selectable chips + a
free-text "Other"), and submitting the answers resumes the agent with the
answers fed back as the tool result.

### System prompt (optional full Claude Design prompt)

*Model settings → System prompt* toggles between:

- **Condensed** (default) — a lean designer prompt (`agent/systemPrompt.ts`).
- **Full Claude Design** — the bundled `claude_design_system_prompt.md`, imported
  at build time via `?raw` (`agent/fullPrompt.ts`). Only the **design guidance**
  (~29KB / ~7k tokens) is injected; the file's trailing "In this environment…"
  function-call XML mechanics + JSON tool-schema dump are stripped, since they
  conflict with native tool calling, and replaced with a short note mapping to
  this environment's real tools. On Anthropic the system block is sent with
  `cache_control: ephemeral`, so the large prompt is only billed in full on the
  first turn.

### Dual protocol

`stream()` dispatches on `model.api`:

| Provider    | Endpoint                         | Tool calling      |
| ----------- | -------------------------------- | ----------------- |
| `anthropic` | `POST /v1/messages` (SSE)        | `tool_use` blocks |
| `openai`    | `POST /v1/chat/completions` (SSE)| `tool_calls`      |
| `mock`      | in-process generator             | synthesized       |

Adapters convert the unified `Message[]` to each provider's wire format and back
(including grouping Anthropic `tool_result` turns and OpenAI `role:"tool"`
messages).

### CORS / endpoints

`vite.config.ts` proxies `/llm/anthropic/*` → `api.anthropic.com` and
`/llm/openai/*` → `api.openai.com`, so the browser can stream from either
without CORS issues in dev. To use any **OpenAI-compatible** endpoint directly
(Ollama, vLLM, OpenRouter, a gateway), set a **Base URL** in *Model settings*.

## Default model (Volcengine Ark)

Out of the box the app is configured for **`ark-code-latest`** over the
**Anthropic protocol** via Volcengine Ark, proxied through `/llm/ark`
(`vite.config.ts`) so the browser avoids CORS. The API key is read from
`.env.local` (`VITE_ARK_API_KEY`, gitignored) as the default; the system prompt
defaults to **Full Claude Design**. Change any of this in *Model settings*
(provider, model, key, base URL, prompt mode). Ark supports prompt caching, so
the full prompt is only billed in full on the first turn.

## Persistence (server-side SQLite)

Everything (projects, files, chat history, settings) is stored **server-side** in
SQLite at `data/app.db`, written by a small API that runs inside the Vite process
(`server/apiPlugin.ts`, active in `npm run dev` and `vite preview`). No browser
storage quota — large multi-file designs persist fine.

- `GET /api/state` — load everything; `PUT /api/projects/:id` — upsert one project
  (per-project incremental write); `DELETE /api/projects/:id`; `PUT /api/meta` —
  settings/user/tutorial.
- `src/lib/store.ts` keeps an in-memory mirror, **debounces** saves (~500ms), and
  bootstraps from the server on load (with a loading gate in `main.tsx`).
- **One-time recovery:** if the DB is empty on first load, the store imports any
  prior `localStorage['claude-design:v3'|v2|v1']` into the DB, then never touches
  localStorage again. Delete unwanted projects from the gallery card menu.
- `data/` is gitignored. Delete `data/app.db*` to reset to an empty gallery.
