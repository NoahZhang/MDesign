// The full Claude Design prompt, bundled from the source markdown at the repo
// root. The file's tail (the "In this environment…" section + the <functions>
// JSON-schema dump) describes a DIFFERENT, XML-based function-calling mechanism
// that conflicts with our native tool layer — if injected, the model emits
// function-call XML instead of calling tools. So we keep the substantive design
// guidance and replace the trailing mechanics with a note about our real tools.
import raw from '../../claude_design_system_prompt.md?raw'

const MARKERS = [
  'In this environment you have access to a set of tools',
  '\n<functions>',
  'Here are the functions available in JSONSchema',
]

function cutPoint(text: string): number {
  let min = -1
  for (const m of MARKERS) {
    const i = text.indexOf(m)
    if (i >= 0 && (min < 0 || i < min)) min = i
  }
  return min
}

const i = cutPoint(raw)
const guidance = (i > 0 ? raw.slice(0, i) : raw).trim()

const TOOL_NOTE = `

# Tools (this environment)
Your tools are exposed through the native tool-calling interface — call them directly; never write function-call XML or describe tool schemas. Available tools: write_file, read_file, list_files, str_replace_edit, delete_file, ask_questions, done.

- **Always start with questions.** For EVERY new design request (a page, prototype, component, deck…), your FIRST action MUST be to call **ask_questions** once — a tight clarifying round (purpose, audience, visual style, scope, content) rendered as selectable option cards with a free-text "Other". Do NOT write any file before the user answers. Never ask in plain prose. After calling ask_questions, end your turn and wait. (Only skip this for small follow-up tweaks to a file you already created.)
- **KEEP EACH FILE SMALL — never write one giant file.** A single huge file is slow and can get truncated mid-write (then you'd have to restart it). Keep each file under ~250 lines. For anything beyond a trivial single page, SPLIT THE WORK: put each major section/component in its own small .jsx file, then write a main index.html that loads React + Babel (the pinned CDN script tags from the React+Babel section) and pulls your components in via \`<script type="text/babel" src="component.jsx"></script>\`. Write each small file with its own write_file call (the user watches them appear one by one), then the main index.html, then call done on it. Relative \`src\`/\`href\` references are resolved against the project, so the assembled multi-file result renders correctly in the preview.
- For **slide decks**: write a single \`.html\` file whose body is a sequence of \`<section class="slide">…</section>\` blocks plus a shared \`<style>\`. Make every \`.slide\` exactly **1280×720** (\`width:1280px;height:720px\`, \`position:relative;overflow:hidden\`) with its own background. The app renders a built-in deck viewer (left thumbnail nav + a scaled preview, double-click text to edit) and **Share → PowerPoint (.pptx)** converts the slides to native, editable PPT objects — so do NOT build your own navigation/thumbnails/scaling. Design each slide freely (flexbox/grid, real type), but for clean conversion use **solid fills** (gradients flatten to one color), real selectable **text** (never baked into images), and \`<img>\` for pictures/logos (reference dropped assets by path); avoid \`::before/::after\` content, \`box-shadow\`, and \`backdrop-filter\` for anything that must appear in the .pptx. One .html per deck; \`done\` on it. (No external libraries, no copy_starter_component.)
- A "prototype/原型" is the product's real interface itself — concrete screens with realistic data and working interactions. It is NEVER a page that merely *describes* the product (no requirements lists, feature inventories, 需求文档/功能清单/系统介绍页). Build what the end user would see and click.
- Produce each deliverable with write_file, then call **done** with the main file's path to open it in the user's preview.
- There is no separate verifier or starter-component tool here.`

/** Full design guidance + a tool note reconciled to this environment's tools. */
export const FULL_DESIGN_PROMPT = guidance + TOOL_NOTE

export const FULL_PROMPT_CHARS = FULL_DESIGN_PROMPT.length
export const FULL_PROMPT_TOKENS_APPROX = Math.round(FULL_DESIGN_PROMPT.length / 4)
