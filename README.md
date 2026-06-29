# MDesign

MDesign is a desktop design workspace where you describe what you want and an AI agent builds
it as **real, runnable UI** — prototypes, pages, components, slide decks — rendered live in a
preview beside the chat. It's inspired by the Claude Design workflow: you talk to a designer,
it produces actual product screens (not documents about the product), and you iterate.

The app is a macOS desktop application built on Electron, with a small Rust helper for storage
and PDF handling. The agent that does the work can run in two different ways depending on how
you want it powered.

## How it works

You create a **project**, then chat with the agent. It first asks a short round of clarifying
questions (rendered as selectable options, not free text), then designs the deliverable,
writing files that appear immediately in the file list and render in the preview. Slide decks
can be presented and exported to editable PowerPoint. When it finishes, it runs a quick
self-check on what it produced and fixes any obvious problems before handing it back.

Under the hood the desktop shell runs the agent in the background process (so it can reach
model providers without browser restrictions) and streams the conversation, the files, and
live status back to the window. A bundled Rust helper keeps everything — projects, files,
chat history, settings — in a local database, and extracts text from PDFs you attach as
references.

## Two ways to run the agent

**Model mode** connects directly to a model that speaks the Anthropic or OpenAI protocol
(for example Volcengine Ark / GLM, or any compatible gateway). The agent loop, tool use, and
context management all run inside the app.

**CLI mode** drives a coding CLI you already have installed — **Codex, opencode, or Claude
Code** — as a background process. MDesign feeds it the design guidance and your project files,
streams its progress, keeps each project in its own working directory, and continues the same
CLI session across turns so follow-ups pick up where you left off. This lets you reuse your
existing CLI login and model access.

Either way the experience is the same: clarifying questions up front, live files and progress,
a consistent design system, and a self-check at the end. You switch modes and pick the model
or CLI from the composer.

## Design systems

A design system in MDesign is a written **brand spec** — atmosphere, color roles, a type
scale, component styling, spacing, elevation, do's and don'ts, voice — together with the core
tokens (colors, fonts, corner radius). The agent applies it consistently across every page,
defining the tokens as CSS variables and loading the right fonts.

You can pick from built-in starter systems (Apple, and a few opinionated directions like
minimal, professional, vibrant, and dark-tech), or **generate one automatically** from a
website URL or a one-line description — MDesign reads the site's real colors, fonts, and
spacing and the model writes a full spec from it. If you don't pick anything, the agent still
commits to one coherent direction derived from your answers to its questions, rather than
defaulting to a generic look.

## Running it

Install dependencies with `npm install`, then:

- `npm run dev` — fastest iteration in the browser.
- `npm run electron:dev` — run the desktop shell against the dev server.
- `npm run dist:mac` — build and package a macOS `.dmg`.

The browser and dev shell need only Node. Packaging the `.dmg` additionally needs Rust (for
the helper) and the Xcode command-line tools. To use **CLI mode** you need the chosen CLI
installed and logged in locally (Codex, opencode, or Claude Code).

## Configuration

For model mode, add a model in the app (provider, model id, API key, optional base URL); a
default key can be read from a gitignored `.env.local` and is never committed. For CLI mode,
add a CLI agent in settings — it uses your local login by default, and you can override its
base URL, model, reasoning level, or proxy. Everything you create is stored locally; deleting
the local database resets the app.

## Packaging note

The packaged app is ad-hoc signed (no Apple Developer certificate), so when you send the
`.dmg` to someone else macOS marks it as quarantined. The recipient opens it once via
right-click → Open, or clears the flag with `xattr -cr /Applications/MDesign.app`.
Distributing it with no warning at all would require Apple Developer ID signing and
notarization.
