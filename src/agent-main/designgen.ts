// Generate a design system from a URL's extracted styles (or a text brief) via one
// LLM call. Runs in Electron main (Node) where there's no CORS to the model gateway.
import { buildTransport, type AppModel } from './transport'

export interface GenInput {
  url?: string
  title?: string
  text?: string
  bgColors?: string[]
  textColors?: string[]
  radii?: number[]
  headingFont?: string
  bodyFont?: string
  sampleText?: string
}

export interface GenResult {
  name: string
  colors: { name: string; value: string }[]
  headingFont: string
  bodyFont: string
  radius: number
  spec: string
}

const SYS =
  'You are a senior brand & design-systems designer. You analyze a website (or a brief) and distill a reusable design system. Output STRICT JSON only — no prose and no markdown code fences.'

function buildPrompt(input: GenInput): string {
  const lines: string[] = []
  if (input.url) lines.push(`Website: ${input.url}${input.title ? ` — ${input.title}` : ''}`)
  if (input.bgColors?.length) lines.push(`Dominant background colors (computed): ${input.bgColors.join(', ')}`)
  if (input.textColors?.length) lines.push(`Dominant text colors (computed): ${input.textColors.join(', ')}`)
  if (input.radii?.length) lines.push(`Common border radii (px): ${input.radii.join(', ')}`)
  if (input.headingFont) lines.push(`Heading font-family stack: ${input.headingFont}`)
  if (input.bodyFont) lines.push(`Body font-family stack: ${input.bodyFont}`)
  if (input.sampleText) lines.push(`Sample copy:\n"""${input.sampleText.slice(0, 1200)}"""`)
  if (input.text) lines.push(`User intent / notes: ${input.text}`)
  if (!lines.length) lines.push('No site data was provided; design a tasteful, modern system from scratch.')

  return `Analyze the following and produce a reusable design system grounded in the data.

${lines.join('\n')}

Return ONLY a JSON object with EXACTLY these keys:
{
  "name": "short brand-like name (<= 24 chars)",
  "colors": [{"name":"role e.g. bg/surface/text/muted/primary/accent/line","value":"#RRGGBB"}],
  "headingFont": "ONE real font family name with NO fallbacks/stack; map a system stack to a close Google Font such as Inter",
  "bodyFont": "ONE real font family name",
  "radius": 12,
  "spec": "a rich DESIGN.md in Markdown using ## sections in this order: Atmosphere & visual theme; Color & roles; Typography (include a concrete type scale display/h1/h2/h3/body/small with px, line-height, weight, letter-spacing); Spacing & layout; Components (buttons/cards/inputs/badges: bg, text, padding, radius, hover); Depth & elevation; Do & Don't; Responsive; Voice. Reference tokens like var(--primary)."
}
Rules: 4-6 color tokens, all #RRGGBB hex. radius is an integer of pixels. The "spec" value must be a single valid JSON string (escape newlines as \\n). Output nothing but the JSON object.`
}

function extractJson(text: string): unknown {
  let t = text.trim()
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = t.indexOf('{')
  if (start < 0) throw new Error('model did not return JSON')
  let depth = 0
  let inStr = false
  let esc = false
  let end = -1
  for (let i = start; i < t.length; i++) {
    const c = t[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
    } else if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }
  return JSON.parse(end > 0 ? t.slice(start, end) : t.slice(start))
}

export async function generateDesignSystem(model: AppModel, input: GenInput): Promise<GenResult> {
  const { model: m, options, streamFn } = buildTransport(model)
  const ctx = { systemPrompt: SYS, messages: [{ role: 'user' as const, content: buildPrompt(input), timestamp: 0 }] }
  const call = streamFn as unknown as (
    model: unknown,
    context: unknown,
    options: unknown,
  ) => AsyncIterable<unknown> & { result(): Promise<{ content?: unknown }> }
  const stream = call(m, ctx, options)
  for await (const ev of stream) void ev
  const res = await stream.result()
  const content = res?.content
  const text = Array.isArray(content)
    ? content
        .filter((b): b is { type: string; text: string } => !!b && (b as { type?: string }).type === 'text')
        .map((b) => b.text)
        .join('')
    : String(content ?? '')

  const j = extractJson(text) as Partial<GenResult> & { colors?: unknown }
  const firstFamily = (s: unknown) =>
    String(s ?? '')
      .replace(/["']/g, '')
      .split(',')[0]
      .trim()
  const colors = Array.isArray(j.colors)
    ? (j.colors as { name?: unknown; value?: unknown }[])
        .filter((c) => c && typeof c.value === 'string' && /^#?[0-9a-fA-F]{3,8}$/.test(String(c.value)))
        .map((c) => ({
          name: String(c.name ?? 'color'),
          value: String(c.value).startsWith('#') ? String(c.value) : '#' + String(c.value),
        }))
    : []
  return {
    name: String(j.name || input.title || 'Generated').slice(0, 40),
    colors,
    headingFont: firstFamily(j.headingFont) || 'Inter',
    bodyFont: firstFamily(j.bodyFont) || firstFamily(j.headingFont) || 'Inter',
    radius: Number.isFinite(Number(j.radius)) ? Math.max(0, Math.round(Number(j.radius))) : 12,
    spec: String(j.spec || ''),
  }
}
