import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { app } from 'electron'
import { getDb, getSetting } from '../db'
import { listVideos, getVideoDetail } from './videos'
import { listCategories, listTags } from './meta'
import type { ServerStatus, VideoListQuery, VideoListItem } from '../../shared/types'

// ================= 配对与令牌 =================

interface PendingPair {
  code: string
  deviceName: string
  expiresAt: number
}

/** 下载令牌：token → 视频 id（10 分钟有效） */
interface DownloadTicket {
  videoId: number
  expiresAt: number
}

const pendingPairs = new Map<string, PendingPair>()
const downloadTickets = new Map<string, DownloadTicket>()

const PAIR_TTL_MS = 5 * 60 * 1000
const DOWNLOAD_TTL_MS = 10 * 60 * 1000

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function newPairCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

/** 当前有效的待配对码（供 Windows UI 展示） */
export function getCurrentPairCode(): string | null {
  const now = Date.now()
  for (const p of pendingPairs.values()) {
    if (p.expiresAt > now) return p.code
  }
  return null
}

function checkAuth(req: IncomingMessage): boolean {
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return false
  const row = getDb()
    .prepare('SELECT id FROM paired_devices WHERE token_hash = ?')
    .get(hashToken(token)) as { id: number } | undefined
  if (!row) return false
  getDb().prepare('UPDATE paired_devices SET last_seen_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(row.id)
  return true
}

function checkDownloadTicket(req: IncomingMessage, videoId: number): boolean {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const token = url.searchParams.get('token') ?? ''
  if (!token) return false
  const ticket = downloadTickets.get(token)
  if (!ticket || ticket.videoId !== videoId || ticket.expiresAt < Date.now()) return false
  // 注意：token 在 TTL 内可复用（断点续传需要多次 Range 请求）
  return true
}

// ================= 服务器 =================

let server: Server | null = null

export function isServerRunning(): boolean {
  return server?.listening ?? false
}

export function getLanAddress(): string | null {
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) return info.address
    }
  }
  return null
}

export function getServerStatus(): ServerStatus {
  const port = Number(getSetting('server_port') ?? '8720')
  const count = getDb()
    .prepare('SELECT COUNT(*) AS c FROM paired_devices')
    .get() as { c: number }
  const devices = getDb()
    .prepare(
      'SELECT id, device_name, last_seen_at FROM paired_devices ORDER BY last_seen_at DESC'
    )
    .all() as unknown as Array<{ id: number; device_name: string; last_seen_at: string | null }>
  return {
    running: isServerRunning(),
    port,
    address: getLanAddress(),
    pairCode: getCurrentPairCode(),
    pairedDevices: count.c,
    devices: devices.map((d) => ({
      id: d.id,
      name: d.device_name,
      lastSeenAt: d.last_seen_at
    }))
  }
}

export function startHttpServer(): { port: number; error: string | null } {
  stopHttpServer()
  const port = Number(getSetting('server_port') ?? '8720')
  try {
    server = createServer(handler)
    server.listen(port, '0.0.0.0')
    console.log(`[videomanager] HTTP 服务已启动: http://0.0.0.0:${port}`)
    return { port, error: null }
  } catch (err) {
    console.error('[videomanager] HTTP 服务启动失败:', err)
    return { port, error: err instanceof Error ? err.message : String(err) }
  }
}

export function stopHttpServer(): void {
  if (server) {
    server.close()
    server = null
  }
}

// ================= 工具 =================

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  })
  res.end(body)
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { code, message })
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
      if (body.length > 1024 * 1024) {
        reject(new Error('body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        reject(new Error('invalid json'))
      }
    })
    req.on('error', reject)
  })
}

function toApiItem(v: VideoListItem): Record<string, unknown> {
  return {
    id: v.id,
    title: v.title,
    fileName: v.fileName,
    fileSize: v.fileSize,
    duration: v.duration,
    width: v.width,
    height: v.height,
    codec: v.codec,
    format: v.format,
    categoryId: v.categoryId,
    category: v.category,
    tags: v.tags,
    rating: v.rating,
    isFavorite: v.isFavorite === 1,
    thumbnailUrl: `/api/thumbnail/${v.id}`,
    dateAdded: v.dateAdded,
    status: v.status,
    author: v.author,
    orientation: v.orientation,
    sha256: v.sha256,
    hashComputed: v.hashComputed,
    metaUpdatedAt: v.metaUpdatedAt
  }
}

function parseVideosQuery(url: URL): VideoListQuery {
  return {
    page: Number(url.searchParams.get('page') ?? '1'),
    pageSize: Number(url.searchParams.get('pageSize') ?? '50'),
    search: url.searchParams.get('search') ?? '',
    categoryId: url.searchParams.get('categoryId') ? Number(url.searchParams.get('categoryId')) : null,
    tagId: url.searchParams.get('tagId') ? Number(url.searchParams.get('tagId')) : null,
    authorId: url.searchParams.get('authorId') ? Number(url.searchParams.get('authorId')) : null,
    favorite: url.searchParams.get('favorite') === 'true',
    // 安卓默认同步全部（含缺失/恢复占位）；显式 includeMissing=false 才排除
    includeMissing: url.searchParams.get('includeMissing') === null ? true : url.searchParams.get('includeMissing') === 'true',
    sortBy: (url.searchParams.get('sortBy') as VideoListQuery['sortBy']) ?? 'date_added',
    sortDir: (url.searchParams.get('sortDir') as VideoListQuery['sortDir']) ?? 'desc'
  }
}

// ================= 路由 =================

async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const path = url.pathname
  const method = req.method ?? 'GET'

  try {
    // ---- 无需认证 ----
    if (method === 'GET' && path === '/api/health') {
      const count = getDb().prepare('SELECT COUNT(*) AS c FROM videos WHERE status != \'missing\'').get() as { c: number }
      sendJson(res, 200, {
        status: 'ok',
        version: app.getVersion(),
        videoCount: count.c,
        dbStatus: 'ready'
      })
      return
    }

    if (method === 'POST' && path === '/api/auth/pair') {
      const body = await readJsonBody(req)
      const deviceName = String(body.deviceName ?? '未知设备')
      const pairId = randomBytes(8).toString('hex')
      const code = newPairCode()
      pendingPairs.set(pairId, {
        code,
        deviceName,
        expiresAt: Date.now() + PAIR_TTL_MS
      })
      console.log(`[videomanager] 配对请求 device=${deviceName} pairId=${pairId} code=${code}`)
      sendJson(res, 200, { pairId, expiresIn: PAIR_TTL_MS / 1000 })
      return
    }

    if (method === 'POST' && path === '/api/auth/confirm') {
      const body = await readJsonBody(req)
      const pairId = String(body.pairId ?? '')
      const pairCode = String(body.pairCode ?? '')
      const deviceId = String(body.deviceId ?? '')
      const pair = pendingPairs.get(pairId)
      if (!pair || pair.expiresAt < Date.now()) {
        sendError(res, 403, 'PAIR_EXPIRED', '配对码已过期，请重新发起配对')
        return
      }
      if (pair.code !== pairCode) {
        sendError(res, 403, 'PAIR_INVALID', '配对码不正确')
        return
      }
      pendingPairs.delete(pairId)
      const token = randomBytes(24).toString('hex')
      getDb()
        .prepare(
          `INSERT INTO paired_devices (device_name, device_id, token_hash, last_seen_at)
           VALUES (?, ?, ?, datetime('now','localtime'))
           ON CONFLICT(device_id) DO UPDATE SET device_name = excluded.device_name, token_hash = excluded.token_hash, last_seen_at = datetime('now','localtime')`
        )
        .run(pair.deviceName, deviceId, hashToken(token))
      sendJson(res, 200, {
        token,
        serverName: app.getName(),
        serverVersion: app.getVersion(),
        expiresAt: null
      })
      return
    }

    // ---- 文件下载：dl-token 或 Bearer 任一通过（断点续传）----
    const fileMatch = path.match(/^\/api\/file\/(\d+)$/)
    if (method === 'GET' && fileMatch) {
      const videoId = Number(fileMatch[1])
      const authed = checkAuth(req)
      if (!authed && !checkDownloadTicket(req, videoId)) {
        sendError(res, 401, 'AUTH_REQUIRED', '需要有效的访问令牌或下载令牌')
        return
      }
      const detail = getVideoDetail(videoId)
      if (!detail || !existsSync(detail.filePath)) {
        sendError(res, 404, 'NOT_FOUND', '视频文件不存在')
        return
      }
      await serveFile(res, detail.filePath, req.headers.range)
      return
    }

    // ---- 需认证 ----
    const authed = checkAuth(req)
    if (!authed) {
      sendError(res, 401, 'AUTH_REQUIRED', '需要有效的访问令牌')
      return
    }

    if (method === 'POST' && path === '/api/auth/revoke') {
      const header = req.headers.authorization ?? ''
      const token = header.startsWith('Bearer ') ? header.slice(7) : ''
      getDb().prepare('DELETE FROM paired_devices WHERE token_hash = ?').run(hashToken(token))
      sendJson(res, 200, { ok: true })
      return
    }

    if (method === 'GET' && path === '/api/videos') {
      const result = listVideos(parseVideosQuery(url))
      sendJson(res, 200, {
        items: result.items.map(toApiItem),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize
      })
      return
    }

    const videoMatch = path.match(/^\/api\/videos\/(\d+)$/)
    if (method === 'GET' && videoMatch) {
      const detail = getVideoDetail(Number(videoMatch[1]))
      if (!detail) {
        sendError(res, 404, 'NOT_FOUND', '视频不存在')
        return
      }
      sendJson(res, 200, toApiItem(detail))
      return
    }

    const thumbMatch = path.match(/^\/api\/thumbnail\/(\d+)$/)
    if (method === 'GET' && thumbMatch) {
      await serveThumbnail(res, Number(thumbMatch[1]), req.headers['if-none-match'])
      return
    }

    if (method === 'GET' && path === '/api/categories') {
      sendJson(res, 200, { items: listCategories() })
      return
    }

    if (method === 'GET' && path === '/api/tags') {
      sendJson(res, 200, { items: listTags() })
      return
    }

    if (method === 'GET' && path === '/api/meta/sync') {
      // 元数据全量清单（安卓打开时自动同步全部数据，含缺失/恢复占位，按 meta_updated_at 判断增量由客户端过滤）
      const db = getDb()
      const rows = db
        .prepare(
          `SELECT v.id, v.title, v.file_name, v.file_size, v.duration, v.width, v.height,
                  v.codec, v.format, v.category_id, c.name AS category, v.rating, v.is_favorite,
                  v.thumbnail_path, v.date_added, v.status, v.remark,
                  v.author_id, a.name AS author_name, v.sha256, v.meta_updated_at
           FROM videos v
           LEFT JOIN categories c ON c.id = v.category_id
           LEFT JOIN authors a ON a.id = v.author_id
           ORDER BY v.id`
        )
        .all() as unknown as Array<Record<string, unknown>>
      const tagRows = db
        .prepare(
          `SELECT v.id AS video_id, t.name FROM video_tags vt
           JOIN videos v ON v.id = vt.video_id
           JOIN tags t ON t.id = vt.tag_id
           ORDER BY t.name`
        )
        .all() as unknown as Array<{ video_id: number; name: string }>
      const tagsByVideo = new Map<number, string[]>()
      for (const r of tagRows) {
        const list = tagsByVideo.get(r.video_id) ?? []
        list.push(r.name)
        tagsByVideo.set(r.video_id, list)
      }
      const items = rows.map((r) => ({
        id: r.id as number,
        title: r.title as string,
        fileName: r.file_name as string,
        fileSize: r.file_size as number,
        duration: (r.duration as number | null) ?? null,
        width: (r.width as number | null) ?? null,
        height: (r.height as number | null) ?? null,
        codec: (r.codec as string | null) ?? null,
        format: (r.format as string | null) ?? null,
        categoryId: (r.category_id as number | null) ?? null,
        category: (r.category as string | null) ?? null,
        tags: tagsByVideo.get(r.id as number) ?? [],
        rating: (r.rating as number | null) ?? null,
        isFavorite: (r.is_favorite as number) === 1,
        thumbnailUrl: `/api/thumbnail/${r.id}`,
        dateAdded: r.date_added as string,
        status: r.status as string,
        remark: (r.remark as string | null) ?? null,
        author: ((r.author_name as string | null) ?? null) as string | null,
        sha256: (r.sha256 as string | null) ?? null,
        metaUpdatedAt: (r.meta_updated_at as string | null) ?? null
      }))
      sendJson(res, 200, {
        items,
        serverTime: new Date().toISOString()
      })
      return
    }

    const downloadMatch = path.match(/^\/api\/download\/(\d+)$/)
    if (method === 'POST' && downloadMatch) {
      const videoId = Number(downloadMatch[1])
      const detail = getVideoDetail(videoId)
      if (!detail || !existsSync(detail.filePath)) {
        sendError(res, 404, 'NOT_FOUND', '视频文件不存在')
        return
      }
      const dlToken = randomBytes(16).toString('hex')
      downloadTickets.set(dlToken, { videoId, expiresAt: Date.now() + DOWNLOAD_TTL_MS })
      sendJson(res, 202, {
        url: `/api/file/${videoId}?token=${dlToken}`,
        expiresIn: DOWNLOAD_TTL_MS / 1000,
        fileSize: detail.fileSize
      })
      return
    }

    if (method === 'GET' && path === '/api/sync/changes') {
      const since = url.searchParams.get('since') ?? ''
      const db = getDb()
      const changedRows = since
        ? db
            .prepare("SELECT id FROM videos WHERE status != 'missing' AND date_added >= :since")
            .all({ since }) 
        : []
      const deletedRows = db.prepare("SELECT id FROM videos WHERE status = 'missing'").all() as unknown as Array<{ id: number }>
      const changed = (changedRows as unknown as Array<{ id: number }>)
        .map((r) => getVideoDetail(r.id))
        .filter((v): v is VideoListItem => v !== null)
        .map(toApiItem)
      sendJson(res, 200, {
        changed,
        deletedIds: deletedRows.map((r) => r.id),
        serverTime: new Date().toISOString(),
        hasMore: false
      })
      return
    }

    sendError(res, 404, 'NOT_FOUND', `接口不存在: ${method} ${path}`)
  } catch (err) {
    console.error('[videomanager] HTTP 处理错误:', err)
    sendError(res, 500, 'INTERNAL', err instanceof Error ? err.message : String(err))
  }
}

async function serveThumbnail(
  res: ServerResponse,
  videoId: number,
  ifNoneMatch: string | undefined
): Promise<void> {
  const detail = getVideoDetail(videoId)
  if (!detail || !detail.thumbnailPath || !existsSync(detail.thumbnailPath)) {
    sendError(res, 404, 'NOT_FOUND', '缩略图不存在')
    return
  }
  const st = statSync(detail.thumbnailPath)
  const etag = `"${st.mtimeMs}-${st.size}"`
  if (ifNoneMatch === etag) {
    res.writeHead(304, { ETag: etag })
    res.end()
    return
  }
  res.writeHead(200, {
    'Content-Type': 'image/jpeg',
    'Content-Length': st.size,
    ETag: etag,
    'Cache-Control': 'private, max-age=604800'
  })
  createReadStream(detail.thumbnailPath).pipe(res)
}

async function serveFile(
  res: ServerResponse,
  filePath: string,
  rangeHeader: string | undefined
): Promise<void> {
  const st = statSync(filePath)
  const total = st.size
  let start = 0
  let end = total - 1
  let status = 200

  const range = rangeHeader
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    if (m && (m[1] !== '' || m[2] !== '')) {
      if (m[1] !== '' && m[2] !== '') {
        start = Number(m[1])
        end = Math.min(Number(m[2]), total - 1)
      } else if (m[1] !== '') {
        start = Number(m[1])
      } else {
        const suffix = Number(m[2])
        start = Math.max(total - suffix, 0)
      }
      if (start > end || start >= total) {
        res.writeHead(416, {
          'Content-Range': `bytes */${total}`,
          'Accept-Ranges': 'bytes'
        })
        res.end()
        return
      }
      status = 206
    }
  }

  const headers: Record<string, string | number> = {
    'Content-Type': 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Content-Disposition': 'attachment'
  }
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${total}`
  res.writeHead(status, headers)
  createReadStream(filePath, { start, end }).pipe(res)
}
