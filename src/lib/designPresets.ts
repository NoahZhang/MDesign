import type { DesignSystem } from './types'

/** Empty 9-section scaffold inserted by the editor's "insert template" button. */
export const SPEC_TEMPLATE = `## Atmosphere & visual theme
(Overall mood in 1-2 sentences: e.g. quiet & editorial / bold & energetic / dark & technical.)

## Color & roles
(Which color does what: background, text, secondary text, borders, primary/CTA, accent. Reference the tokens.)

## Typography
(Font(s) + a type scale: display / h1 / h2 / h3 / body / small / caption — size, line-height, weight, letter-spacing. How many weights to use.)

## Spacing & layout
(Base spacing unit, section padding, max content width, grid/columns, density.)

## Components
(Buttons, cards, inputs, badges, nav: background, text, padding, radius, border, hover/active states.)

## Depth & elevation
(Shadow philosophy + levels, or "flat / hairline borders only".)

## Do & Don't
(Concrete dos and don'ts that define the brand.)

## Responsive
(Mobile behavior, breakpoints, touch targets.)

## Voice
(Copy tone: words to use / avoid.)`

const mk = (
  id: string,
  name: string,
  headingFont: string,
  bodyFont: string,
  radius: number,
  colors: [string, string][],
  spec: string,
): DesignSystem => ({
  id,
  name,
  headingFont,
  bodyFont,
  radius,
  colors: colors.map(([n, v]) => ({ name: n, value: v })),
  spec: spec.trim(),
})

const MINIMAL = mk(
  'ds_preset_minimal',
  '极简留白',
  'Inter',
  'Inter',
  6,
  [
    ['ink', '#1A1A1A'],
    ['paper', '#FAFAF8'],
    ['muted', '#6B6B6B'],
    ['line', '#E6E4DF'],
    ['accent', '#1A1A1A'],
  ],
  `
## Atmosphere & visual theme
Quiet, editorial, generous whitespace. Near-monochrome and airy; confidence through restraint, not decoration.

## Color & roles
Background \`--paper\`; primary text \`--ink\`; secondary text \`--muted\`; hairline dividers/borders \`--line\`. Accent is \`--ink\` itself — color is used sparingly, almost never as fill.

## Typography (Inter)
Two weights only (400 / 600). Display 48px/1.1 w600 -0.02em · H1 32/1.2 w600 · H2 24/1.25 w600 · H3 18/1.4 w600 · Body 16/1.65 w400 · Small 14/1.5 w400 · Caption 12 w500 uppercase tracking .06em.

## Spacing & layout
8px base unit. Section vertical padding 96px desktop. Max width 720px for text, 1080px for app layouts. Whitespace is the main design tool — be generous.

## Components
Buttons: \`--ink\` bg / \`--paper\` text, padding 10×20, radius var(--radius), no shadow, hover slightly lighter. Cards: \`--paper\` with 1px \`--line\` border, radius 8, padding 24, no shadow. Inputs: 1px \`--line\`, radius var(--radius), focus border \`--ink\`.

## Depth & elevation
Flat. Use hairline borders + spacing for hierarchy. At most a faint \`0 1px 2px rgba(0,0,0,.04)\`.

## Do & Don't
Do: whitespace, hairline rules, one restrained accent, left-aligned text. Don't: gradients, drop shadows, large radii, more than ~3 colors, decorative icons.

## Responsive
<640px single column, 16px gutters, section padding 48px. Touch targets ≥44px.

## Voice
Calm, precise, understated. Short sentences.
`,
)

const PROFESSIONAL = mk(
  'ds_preset_professional',
  '专业商务',
  'IBM Plex Sans',
  'IBM Plex Sans',
  8,
  [
    ['primary', '#1E40AF'],
    ['navy', '#0F172A'],
    ['slate', '#475569'],
    ['surface', '#FFFFFF'],
    ['canvas', '#F1F5F9'],
    ['line', '#E2E8F0'],
  ],
  `
## Atmosphere & visual theme
Trustworthy, structured, enterprise. Clean grids, calm blues, clear hierarchy. Feels reliable and precise.

## Color & roles
Page \`--canvas\`; cards/surfaces \`--surface\`; headings \`--navy\`; body \`--slate\`; primary actions & links \`--primary\`; borders \`--line\`.

## Typography (IBM Plex Sans)
H1 34/1.2 w600 · H2 26 w600 · H3 20 w600 · Body 16/1.6 w400 · Small 14 w400 · Label 13 w500. Numbers/data use tabular figures (\`font-variant-numeric: tabular-nums\`).

## Spacing & layout
8px base. 12-column grid, max width 1200px, 24–32px gutters. Generous but dense enough for data. Section padding 64–80px.

## Components
Buttons: primary = \`--primary\` bg / white text, radius var(--radius), padding 10×18, subtle shadow; secondary = white bg / \`--line\` border / \`--navy\` text. Cards: \`--surface\`, radius var(--radius), 1px \`--line\`, shadow level 1, padding 24. Inputs: 1px \`--line\`, radius var(--radius), focus ring \`--primary\`. Tables: zebra rows on \`--canvas\`.

## Depth & elevation
Subtle, neutral shadows. L1 \`0 1px 2px rgba(15,23,42,.06)\`; L2 \`0 4px 12px rgba(15,23,42,.08)\` for popovers/modals. Never heavy.

## Do & Don't
Do: clear hierarchy, aligned grids, tabular numbers, restrained blue accent. Don't: playful gradients, neon, oversized radii, decorative fonts.

## Responsive
Collapse 12-col → 1-col under 768px; sticky top nav; tables become stacked cards under 640px.

## Voice
Professional, clear, confident. Avoid hype and exclamation marks.
`,
)

const VIBRANT = mk(
  'ds_preset_vibrant',
  '活力现代',
  'Poppins',
  'Inter',
  18,
  [
    ['primary', '#7C3AED'],
    ['accent', '#EC4899'],
    ['sun', '#F59E0B'],
    ['ink', '#1E1B2E'],
    ['paper', '#FFFFFF'],
    ['wash', '#F5F3FF'],
  ],
  `
## Atmosphere & visual theme
Energetic, friendly, modern consumer. Big rounded shapes, bold color, playful but clean. Optimistic.

## Color & roles
Background \`--paper\` / soft \`--wash\` sections; text \`--ink\`; primary \`--primary\`; secondary accent \`--accent\`; highlights \`--sun\`. Gradients allowed: \`--primary\`→\`--accent\` for heroes/CTAs.

## Typography (Poppins headings / Inter body)
Display 56/1.05 w700 -0.02em · H1 40 w700 · H2 28 w600 · H3 20 w600 · Body 17/1.6 w400 · Small 14 w400. Headings can be tight and punchy.

## Spacing & layout
8px base. Roomy: section padding 80–120px. Max width 1120px. Asymmetric, lively compositions; large hero blocks.

## Components
Buttons: \`--primary\` (or gradient) bg / white text, radius var(--radius) (pill-ish), padding 12×24, bold, shadow + lift on hover. Cards: \`--paper\`, radius var(--radius) large, soft colored shadow, padding 28. Badges: tinted pill backgrounds. Generous use of rounded corners.

## Depth & elevation
Soft, slightly colored shadows: \`0 8px 24px rgba(124,58,237,.18)\`. Hover lifts (translateY -2px). Friendly, not harsh.

## Do & Don't
Do: bold color, big radii, gradients, motion/hover lift, expressive headings. Don't: dull grays everywhere, tiny cramped text, hard right angles, corporate stiffness.

## Responsive
Single column under 768px; keep big touch targets and generous padding; scale display type down ~30%.

## Voice
Warm, upbeat, human. Short, encouraging copy.
`,
)

const DARK_TECH = mk(
  'ds_preset_dark',
  '暗色科技',
  'Inter',
  'Inter',
  10,
  [
    ['bg', '#0B0D12'],
    ['surface', '#14171F'],
    ['line', '#232733'],
    ['text', '#E6E8EC'],
    ['muted', '#8A92A6'],
    ['accent', '#5B8CFF'],
  ],
  `
## Atmosphere & visual theme
Dark, precise, technical — Linear / Vercel territory. High contrast, crisp edges, restrained glow. Feels fast and engineered.

## Color & roles
Page \`--bg\`; panels/cards \`--surface\`; borders \`--line\`; primary text \`--text\`; secondary \`--muted\`; single electric accent \`--accent\` for actions/focus/links. Mono (JetBrains Mono / ui-monospace) for code & data.

## Typography (Inter)
H1 36/1.15 w600 -0.02em · H2 26 w600 · H3 18 w600 · Body 15/1.6 w400 · Small 13 w400 · Mono 13 for code. Tight tracking on large headings.

## Spacing & layout
8px base, dense and deliberate. Max width 1080px. Thin 1px \`--line\` separators define structure. Section padding 72px.

## Components
Buttons: primary = \`--accent\` bg / \`--bg\` text, radius var(--radius), padding 9×16, subtle glow on hover; ghost = transparent / \`--line\` border / \`--text\`. Cards: \`--surface\`, 1px \`--line\`, radius var(--radius), no heavy shadow. Inputs: \`--surface\`, 1px \`--line\`, focus border \`--accent\` + faint ring.

## Depth & elevation
Mostly flat on dark; separate with \`--line\` borders and slight surface lightening. Optional accent glow \`0 0 0 1px rgba(91,140,255,.4)\` on focus. No soft drop shadows.

## Do & Don't
Do: high contrast, 1px borders, one electric accent, mono for numbers/code, crisp small radii. Don't: light backgrounds, multiple bright colors, big soft shadows, pastel gradients.

## Responsive
Single column under 768px; keep dense spacing; ensure contrast stays AA on dark.

## Voice
Terse, technical, confident. Precise nouns, few adjectives.
`,
)

const APPLE = mk(
  'ds_preset_apple',
  'Apple',
  'SF Pro Display',
  'SF Pro Text',
  12,
  [
    ['bg', '#FFFFFF'],
    ['surface', '#F5F5F7'],
    ['text', '#1D1D1F'],
    ['muted', '#6E6E73'],
    ['line', '#D2D2D7'],
    ['accent', '#0071E3'],
  ],
  `
## Atmosphere & visual theme
Apple.com: precision through restraint. Near-monochrome neutrals, generous whitespace; product photography carries the visual tension while the interface stays quiet and low-key.

## Color & roles
Background \`--bg\` #FFFFFF; section surfaces \`--surface\` #F5F5F7; primary text \`--text\` #1D1D1F; secondary text \`--muted\` #6E6E73; hairline borders \`--line\` #D2D2D7. The ONE accent \`--accent\` #0071E3 (blue) is reserved strictly for links, CTAs and interactive/focus states. Dark hero sections may use #000000 with graphite layers (#272729–#2A2A2C).

## Typography (SF Pro Display headings / SF Pro Text body)
Compact, semibold display + tight body. Hero 56–80px / 1.05 / w600 / tracking ≈ -1px · Section 48px w500-600 -0.14px · Heading 40px w600 · Card title 28px w600 · Subhead 19px w600 · Body 17px / 1.47 / w400 / -0.374px · Label 14px · Micro 12px. Keep display type tight; never loosen letter-spacing.

## Spacing & layout
8px base (micro 2/4/6). Section vertical padding: 100px desktop / 64 tablet / 40 mobile. Max content width 1024px; gutters 22/18/16. Separate sections with tonal contrast + whitespace, not decorative dividers.

## Components
Buttons: primary \`--accent\` bg / white text, radius 8px, compact padding; dark fill uses #1D1D1F; signature CTAs are pills (radius up to 980px). Cards: on \`--surface\` or white, image-first, radius 18px (config panels 12px, focus modules 28–36px); border-led in dense/retail zones with minimal ornament. Inputs: white / semi-transparent bg, \`--line\` border, dark text.

## Depth & elevation
Restrained. L0 flat (#fff / #f5f5f7 / #000); L1 hairline border (#D2D2D7); L2 soft shadow rgba(0,0,0,.08–.12) for elevated cards; deep contexts use graphite surfaces rather than thick shadows. Focus = blue ring (#0071E3). Decorative depth comes from photorealistic product imagery, not synthetic UI effects.

## Do & Don't
Do: neutral trio (#000 / #f5f5f7 / #fff) as the structural foundation; reserve blue for real operations; keep display type compact; match corner radius to component class; let product imagery lead. Don't: add accent colors competing with Apple blue; over-apply shadows/glow/gradients; mix unrelated typefaces; flatten all radii to one value; load commerce modules with loud borders.

## Responsive
Breakpoints ≈ 375 / 640 / 834 / 1024 / 1440. Multi-column marketing folds to stacked cards; display type scales down while preserving hierarchy; hero stays dominant on mobile with text repositioned. Capsule and circular controls stay tap-friendly.

## Voice
Minimal, direct, product-first. Labels and copy stay understated; the product, material and photography do the talking.
`,
)

/** Built-in starter design systems users can clone or use as-is. */
export function designPresets(): DesignSystem[] {
  return [APPLE, MINIMAL, PROFESSIONAL, VIBRANT, DARK_TECH]
}
