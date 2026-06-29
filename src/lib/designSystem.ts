import type { DesignSystem } from './types'

const slug = (s: string) => s.toLowerCase().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'token'

const quoteFont = (f: string): string => {
  const name = f.trim().replace(/["']/g, '')
  if (!name) return ''
  return (/\s/.test(name) ? `"${name}"` : name) + ', sans-serif'
}

// Fonts that ship with the OS (or aren't on Google Fonts) — don't request them.
const SYSTEM_FONT = /^(SF |-apple-system|system-ui|ui-|BlinkMac|Helvetica|Arial|Segoe|Menlo|Monaco|Courier|Times|Georgia)/i

/** A Google Fonts <link> for the system's fonts, so they actually load (or '' if none). */
export function googleFontsLink(ds: DesignSystem): string {
  const fams = [...new Set([ds.headingFont, ds.bodyFont].map((f) => (f || '').trim()).filter(Boolean))].filter(
    (f) => !SYSTEM_FONT.test(f),
  )
  if (!fams.length) return ''
  const q = fams.map((f) => 'family=' + encodeURIComponent(f).replace(/%20/g, '+') + ':wght@300;400;500;600;700').join('&')
  return (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
    `<link href="https://fonts.googleapis.com/css2?${q}&display=swap" rel="stylesheet">`
  )
}

/** Compiled :root token block (colors + fonts + radius) the agent pastes into each page's <style>. */
export function tokensCss(ds: DesignSystem): string {
  const colors = ds.colors.filter((c) => c.value && c.value.trim())
  const css: string[] = [':root{']
  for (const c of colors) css.push(`  --${slug(c.name || 'color')}: ${c.value};`)
  const hf = quoteFont(ds.headingFont)
  const bf = quoteFont(ds.bodyFont)
  if (hf) css.push(`  --font-heading: ${hf};`)
  if (bf) css.push(`  --font-body: ${bf};`)
  css.push(`  --radius: ${ds.radius}px;`)
  css.push('}')
  return css.join('\n')
}

// When no brand is pinned, the agent must STILL impose one coherent design system —
// derived from the user's clarifying-question answers + the subject, not picked
// arbitrarily — and carry it through every page via shared CSS variables. Distilled
// from Anthropic's frontend-design skill (which the Full prompt defers to but our agent
// never receives).
const SELF_DIRECTED_DESIGN = `
## Design system — derive it from the brief, then carry it through
No brand is pinned, so YOU define the visual system. Do NOT pick it arbitrarily or fall back to a house style:
1. GROUND IT in the user's answers to your clarifying questions (chosen visual style, vibe, audience, domain, any reference brands) and the subject matter itself — the product's world and vernacular are where distinctive choices come from. If the project already has an established theme, reuse it exactly; otherwise set one now and keep it.
2. COMMIT to one distinctive direction that matches what they asked for. Consciously AVOID the generic "AI" defaults that show up regardless of subject: warm cream + serif/terracotta, near-black + acid-green accent, broadsheet newspaper. Don't use them unless the brief actually calls for it.
3. Define a compact TOKEN SYSTEM:
   - 4–6 named colors — a primary tied to the subject + a neutral scale (bg/surface/text/muted/border) + semantic as needed; concrete hex.
   - A deliberate type pairing (display + body, + mono for numbers/code) with an intentional scale (sizes/weights/tracking); type carries the personality. Load the fonts via a Google Fonts <link>.
   - Spacing rhythm (8px base), one base radius, 2–3 shadow/elevation levels; match execution to the vision (minimal → precision; maximal → elaborate).
   - A consistent component vocabulary (buttons/cards/inputs/tags: shared padding, radius, color, states); controls use active, specific labels ("Save changes", not "Submit").
4. Encode all of it as :root CSS custom properties (--primary, --bg, --text, --radius, --font-heading, …) and reference via var(--…) — never hard-code ad-hoc per-page values. Mind CSS specificity so section/element selectors don't cancel your spacing.
5. Reuse the SAME :root tokens + component styles across EVERY page/file — one coherent product, not separate experiments. Before building, sanity-check the plan and revise anything that reads like a generic default.`

/**
 * System-prompt block for the agent. With a pinned brand it's the brand contract
 * (token summary + rich spec + "how to apply"). With no brand it's a directive to
 * derive a fitting design system from the brief and carry it through (shared CSS vars).
 */
export function designSystemPrompt(ds: DesignSystem | null | undefined): string {
  if (!ds) return SELF_DIRECTED_DESIGN
  const colors = ds.colors.filter((c) => c.value && c.value.trim())
  const out: string[] = [
    '',
    `## Active design system — ${ds.name || 'Brand'}`,
    'This is the BRAND CONTRACT for everything you create. Follow it precisely; do not invent off-brand colors, fonts, radii, or styles. The design spec below defines the actual look — atmosphere, type scale, components, spacing, elevation, voice.',
  ]
  if (colors.length) out.push('Colors: ' + colors.map((c) => `${c.name || 'color'} ${c.value}`).join(', '))
  if (ds.headingFont || ds.bodyFont)
    out.push(`Fonts — headings: ${ds.headingFont || ds.bodyFont || 'system'}; body: ${ds.bodyFont || ds.headingFont || 'system'}.`)
  out.push(`Corner radius: ${ds.radius}px.`)

  if (ds.spec && ds.spec.trim()) out.push('\n### Design spec\n' + ds.spec.trim())

  const link = googleFontsLink(ds)
  const apply: string[] = ['\n### How to apply — do this in EVERY page/file you create']
  let n = 1
  if (link) apply.push(`${n++}. Load the brand fonts: put this in <head>:\n\`\`\`html\n${link}\n\`\`\``)
  apply.push(
    `${n++}. Paste these tokens at the very top of your <style>, then reference them via var(--…) — never hard-code brand colors/fonts:\n\`\`\`css\n${tokensCss(ds)}\n\`\`\``,
  )
  apply.push(
    `${n++}. Set \`body { font-family: var(--font-body) }\` and headings to \`var(--font-heading)\`; use \`var(--radius)\` for corners and the color variables throughout. Keep this consistent across all files.`,
  )
  out.push(apply.join('\n'))
  return out.join('\n')
}
