import type { Connect, Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

// Disk-backed persistence for the design app. Runs inside the Vite Node process
// (dev + preview) — the browser only talks to it over /api/*. SQLite gives
// per-project incremental writes and crash-safe storage (no localStorage quota).

function openDb(): Database.Database {
  const file = resolve(process.cwd(), 'data/app.db')
  mkdirSync(dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  `)
  return db
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((res, rej) => {
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => res(b))
    req.on('error', rej)
  })
}

function send(res: ServerResponse, code: number, obj?: unknown) {
  res.statusCode = code
  res.setHeader('content-type', 'application/json')
  res.end(obj === undefined ? '' : JSON.stringify(obj))
}

export function apiPlugin(): Plugin {
  let db: Database.Database | null = null

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url || ''
    if (!url.startsWith('/api/')) return next()
    if (!db) db = openDb()
    const database = db

    ;(async () => {
      try {
        // GET /api/state — assemble everything
        if (req.method === 'GET' && url === '/api/state') {
          const rows = database.prepare('SELECT data FROM projects ORDER BY updated_at DESC').all() as { data: string }[]
          const projects = rows.map((r) => JSON.parse(r.data))
          const metaRows = database.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[]
          const meta: Record<string, unknown> = {}
          for (const m of metaRows) meta[m.key] = JSON.parse(m.value)
          return send(res, 200, {
            projects,
            settings: meta.settings ?? null,
            user: meta.user ?? null,
            tutorialDismissed: meta.tutorialDismissed ?? false,
            designSystem: meta.designSystem ?? null,
          })
        }

        // /api/projects/:id  (PUT upsert, DELETE)
        const pm = url.match(/^\/api\/projects\/([^/?]+)$/)
        if (pm) {
          const id = decodeURIComponent(pm[1])
          if (req.method === 'PUT') {
            const project = JSON.parse(await readBody(req))
            database
              .prepare(
                'INSERT INTO projects (id, data, updated_at) VALUES (?,?,?) ' +
                  'ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at',
              )
              .run(id, JSON.stringify(project), project.updatedAt ?? Date.now())
            return send(res, 200, { ok: true })
          }
          if (req.method === 'DELETE') {
            database.prepare('DELETE FROM projects WHERE id=?').run(id)
            return send(res, 200, { ok: true })
          }
        }

        // PUT /api/meta — { settings?, user?, tutorialDismissed? }
        if (url === '/api/meta' && req.method === 'PUT') {
          const patch = JSON.parse(await readBody(req)) as Record<string, unknown>
          const up = database.prepare(
            'INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
          )
          const tx = database.transaction((p: Record<string, unknown>) => {
            for (const k of ['settings', 'user', 'tutorialDismissed', 'designSystem']) {
              if (k in p) up.run(k, JSON.stringify(p[k]))
            }
          })
          tx(patch)
          return send(res, 200, { ok: true })
        }

        return send(res, 404, { error: 'not found' })
      } catch (e) {
        return send(res, 500, { error: e instanceof Error ? e.message : String(e) })
      }
    })()
  }

  return {
    name: 'design-api',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}
