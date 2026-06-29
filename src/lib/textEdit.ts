export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Replace whitespace-normalized `origNorm` text inside source with `next`, tolerating the
// whitespace differences between the rendered textContent and the indented/line-wrapped source
// (the model often wraps paragraphs across lines, so a raw includes() misses them).
export function replaceFlexible(source: string, origNorm: string, next: string): string | null {
  if (source.includes(origNorm)) return source.replace(origNorm, () => next)
  const words = origNorm.split(' ').filter(Boolean).map(escapeRe)
  if (!words.length) return null
  const re = new RegExp(words.join('\\s+'))
  return re.test(source) ? source.replace(re, () => next) : null
}
