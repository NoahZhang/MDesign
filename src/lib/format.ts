export function cnDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** File-list style: "just now", "2 days ago", "over a week ago", then a date. */
export function relTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, (now - ts) / 1000)
  if (s < 45) return 'just now'
  const m = s / 60
  if (m < 60) return `${Math.round(m)} minute${Math.round(m) === 1 ? '' : 's'} ago`
  const h = m / 60
  if (h < 24) return `${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'} ago`
  const d = h / 24
  if (d < 2) return '1 day ago'
  if (d < 7) return `${Math.floor(d)} days ago`
  if (d < 14) return 'over a week ago'
  if (d < 31) return `${Math.floor(d / 7)} weeks ago`
  return cnDate(ts)
}

/** Gallery-card style: "just now" / "N hours ago" / a Chinese date. */
export function galleryDate(ts: number, now = Date.now()): string {
  const s = (now - ts) / 1000
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`
  return cnDate(ts)
}
