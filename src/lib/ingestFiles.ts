import { writeFile } from './store'

// Turn dropped files/folders into project files. Images are stored as data URLs (so they
// render in designs and previews); text files are stored as text. Folders are walked,
// preserving relative paths. Skips junk dirs and caps the count so a stray node_modules
// can't flood the project.

const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'avif'])
const TEXT_EXT = new Set([
  'html', 'htm', 'css', 'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'json', 'svg', 'md', 'markdown',
  'txt', 'csv', 'tsv', 'xml', 'yaml', 'yml', 'toml', 'env', 'gitignore',
])
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache'])
const MAX_FILES = 200
const MAX_BYTES = 12 * 1024 * 1024 // 12MB per file

const ext = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '')

function read(file: File, as: 'text' | 'dataURL'): Promise<string> {
  return new Promise((resolve) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => resolve('')
    if (as === 'text') r.readAsText(file)
    else r.readAsDataURL(file)
  })
}

async function addOne(projectId: string, path: string, file: File): Promise<string | null> {
  if (file.size > MAX_BYTES) return null
  const e = ext(path)
  let content: string
  if (IMG_EXT.has(e)) content = await read(file, 'dataURL')
  else if (TEXT_EXT.has(e) || file.type.startsWith('text/') || e === '') content = await read(file, 'text')
  else content = await read(file, 'dataURL') // unknown binary → preserve as data URL
  if (!content) return null
  writeFile(projectId, path, content)
  return path
}

// FileSystemEntry walking (folder support, Chromium/WebKit)
type Entry = {
  isFile: boolean
  isDirectory: boolean
  name: string
  file?: (cb: (f: File) => void, err: (e: unknown) => void) => void
  createReader?: () => { readEntries: (cb: (e: Entry[]) => void, err: (e: unknown) => void) => void }
}

const entryFile = (entry: Entry) =>
  new Promise<File | null>((resolve) => entry.file?.((f) => resolve(f), () => resolve(null)) ?? resolve(null))

async function walk(entry: Entry, prefix: string, out: { path: string; file: File }[]) {
  if (out.length >= MAX_FILES) return
  if (entry.isFile) {
    const f = await entryFile(entry)
    if (f) out.push({ path: prefix + entry.name, file: f })
  } else if (entry.isDirectory) {
    if (SKIP_DIRS.has(entry.name)) return
    const reader = entry.createReader?.()
    if (!reader) return
    const children: Entry[] = await new Promise((resolve) => {
      const all: Entry[] = []
      const next = () =>
        reader.readEntries((batch) => {
          if (!batch.length) resolve(all)
          else {
            all.push(...batch)
            next()
          }
        }, () => resolve(all))
      next()
    })
    for (const c of children) await walk(c, prefix + entry.name + '/', out)
  }
}

/** Ingest a drop into the project. Returns the paths added (first is good to select). */
export async function ingestDrop(projectId: string, dt: DataTransfer): Promise<string[]> {
  // Capture entries synchronously — DataTransfer is only valid during the event tick.
  const items = dt.items ? Array.from(dt.items) : []
  const entries = items
    .filter((i) => i.kind === 'file')
    .map((i) => (i as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.() ?? null)
  const plainFiles = Array.from(dt.files || [])

  const collected: { path: string; file: File }[] = []
  if (entries.some(Boolean)) {
    for (const entry of entries) if (entry) await walk(entry, '', collected)
  } else {
    for (const f of plainFiles) collected.push({ path: f.name, file: f })
  }

  const added: string[] = []
  for (const { path, file } of collected.slice(0, MAX_FILES)) {
    const safe = path.replace(/^\/+/, '')
    const res = await addOne(projectId, safe, file)
    if (res) added.push(res)
  }
  return added
}
