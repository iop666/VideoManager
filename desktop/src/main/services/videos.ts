import { getDb } from '../db'
import { existsSync, rmSync } from 'node:fs'
import type {
  BatchRemoveResult,
  BatchVideoPatch,
  BatchVideoResult,
  DuplicateGroup,
  KeyframeShot,
  VideoListQuery,
  VideoListResult,
  VideoListItem,
  VideoUpdateFields
} from '../../shared/types'

const SORT_COLUMNS: Record<string, string> = {
  date_added: 'v.date_added',
  title: 'v.title',
  duration: 'v.duration',
  rating: 'v.rating',
  file_size: 'v.file_size',
  play_count: 'v.play_count'
}

/** SQLite LIKE 转义 */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (m) => '\\' + m)
}

/** 视频列表（分页 + 搜索 + 筛选 + 排序），与 api-contract 的 GET /api/videos 对齐 */
export function listVideos(query: VideoListQuery): VideoListResult {
  const db = getDb()
  const page = Math.max(1, query.page || 1)
  // 每页显示自定义范围 2-525（设置页只保留自定义输入；默认 42）
  const pageSize = Math.min(Math.max(1, query.pageSize || 42), 525)
  const search = (query.search ?? '').trim()
  const categoryId = query.categoryId ?? null
  const tagId = query.tagId ?? null
  const authorId = query.authorId ?? null
  const favorite = query.favorite ? 1 : 0
  const orientation = query.orientation ?? null
  const includeMissing = query.includeMissing === true
  const hideLocal = query.hideLocal === true
  const uncategorized = query.uncategorized === true
  const sortCol = SORT_COLUMNS[query.sortBy ?? 'date_added'] ?? 'v.date_added'
  const sortDir = query.sortDir === 'asc' ? 'ASC' : 'DESC'

  const orientationClause =
    orientation === 'landscape'
      ? '(v.width IS NOT NULL AND v.height IS NOT NULL AND v.width > v.height)'
      : orientation === 'portrait'
        ? '(v.width IS NOT NULL AND v.height IS NOT NULL AND v.height > v.width)'
        : orientation === 'square'
          ? '(v.width IS NOT NULL AND v.height IS NOT NULL AND v.width = v.height)'
          : null

  const where = [
    ...(hideLocal ? ["(v.status = 'missing' OR v.file_path LIKE 'restored://%')"] : []),
    // 仅显示本地：排除缺失文件 + 排除恢复占位（restored:// 虚拟路径），只留真实本地文件
    ...(!hideLocal && !includeMissing ? ["v.status != 'missing' AND v.file_path NOT LIKE 'restored://%'"] : []),
    // 未分类：分类或作者至少一项未填写
    ...(uncategorized ? ['(v.category_id IS NULL OR v.author_id IS NULL)'] : []),
    "(:search = '' OR v.title LIKE :searchLike ESCAPE '\\' OR v.file_name LIKE :searchLike ESCAPE '\\')",
    '(:categoryId IS NULL OR v.category_id = :categoryId)',
    '(:tagId IS NULL OR EXISTS (SELECT 1 FROM video_tags vt WHERE vt.video_id = v.id AND vt.tag_id = :tagId))',
    '(:authorId IS NULL OR v.author_id = :authorId)',
    '(:favorite = 0 OR v.is_favorite = 1)',
    ...(orientationClause ? [orientationClause] : [])
  ].join(' AND ')

  const params = {
    search,
    searchLike: `%${escapeLike(search)}%`,
    categoryId,
    tagId,
    authorId,
    favorite
  }

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM videos v LEFT JOIN categories c ON c.id = v.category_id WHERE ${where}`
    )
    .get(params) as { c: number }

  const rows = db
    .prepare(
      `SELECT v.id, v.title, v.file_name, v.more_file_names, v.file_size, v.duration, v.fps, v.frame_count,
              v.keyframes, v.width, v.height,
              v.codec, v.format, v.category_id, c.name AS category, v.rating, v.is_favorite,
              v.thumbnail_path, v.date_added, v.file_path, v.status, v.remark, v.author,
              v.author_id, a.name AS author_name, v.sha256, v.hash_computed,
              v.play_count, v.last_played_at, v.meta_updated_at
       FROM videos v
       LEFT JOIN categories c ON c.id = v.category_id
       LEFT JOIN authors a ON a.id = v.author_id
       WHERE ${where}
       ORDER BY ${sortCol} ${sortDir}, v.id DESC
       LIMIT :limit OFFSET :offset`
    )
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as unknown as Array<
    Record<string, unknown>
  >

  const items = rows.map((r) => rowToItem(r))
  attachTags(items.map((i) => i.id), items)

  return { items, total: totalRow.c, page, pageSize }
}

/** 单个视频完整信息（含标签） */
export function getVideoDetail(id: number): VideoListItem | null {
  const row = getDb()
    .prepare(
      `SELECT v.id, v.title, v.file_name, v.more_file_names, v.file_size, v.duration, v.fps, v.frame_count,
              v.keyframes, v.width, v.height,
              v.codec, v.format, v.category_id, c.name AS category, v.rating, v.is_favorite,
              v.thumbnail_path, v.date_added, v.file_path, v.status, v.remark, v.author,
              v.author_id, a.name AS author_name, v.sha256, v.hash_computed,
              v.play_count, v.last_played_at, v.meta_updated_at
       FROM videos v
       LEFT JOIN categories c ON c.id = v.category_id
       LEFT JOIN authors a ON a.id = v.author_id
       WHERE v.id = ?`
    )
    .get(id) as Record<string, unknown> | undefined
  if (!row) return null
  const items = [rowToItem(row)]
  attachTags([id], items)
  return items[0]
}

/** 更新视频字段（标题/评分/备注/作者/收藏/分类） */
export function updateVideo(id: number, fields: VideoUpdateFields): void {
  const db = getDb()
  const sets: string[] = []
  const values: (string | number | null)[] = []
  const push = (col: string, val: string | number | null): void => {
    sets.push(`${col} = ?`)
    values.push(val)
  }
  if (fields.title !== undefined) push('title', fields.title.trim() || '(未命名)')
  if (fields.rating !== undefined) push('rating', fields.rating)
  if (fields.remark !== undefined) push('remark', fields.remark)
  if (fields.author !== undefined) push('author', fields.author)
  if (fields.authorId !== undefined) {
    push('author_id', fields.authorId)
    // 同步 author 文本（保持两列一致，兼容旧逻辑/API）
    if (fields.authorId === null) push('author', null)
  }
  if (fields.isFavorite !== undefined) push('is_favorite', fields.isFavorite ? 1 : 0)
  if (fields.categoryId !== undefined) push('category_id', fields.categoryId)
  if (sets.length === 0) return
  // 记录元数据保存时间（安卓同步增量依据）
  push("meta_updated_at", "datetime('now','localtime')")
  db.prepare(`UPDATE videos SET ${sets.join(', ')} WHERE id = ?`).run(...values, id)
}

/** 记录一次播放（播放次数 +1，更新时间） */
export function recordPlay(id: number): void {
  getDb()
    .prepare(
      "UPDATE videos SET play_count = play_count + 1, last_played_at = datetime('now','localtime') WHERE id = ?"
    )
    .run(id)
}

/** 按 SHA-256 审查重复视频 */
export function findDuplicates(): DuplicateGroup[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT sha256, COUNT(*) AS c FROM videos
       WHERE sha256 IS NOT NULL AND sha256 != '' AND status != 'missing'
       GROUP BY sha256 HAVING COUNT(*) > 1`
    )
    .all() as unknown as Array<{ sha256: string; c: number }>
  const groups: DuplicateGroup[] = []
  for (const row of rows) {
    const items = db
      .prepare(
        `SELECT id, title, file_path, file_size FROM videos
         WHERE sha256 = ? AND status != 'missing' ORDER BY id`
      )
      .all(row.sha256) as unknown as Array<{ id: number; title: string; file_path: string; file_size: number }>
    groups.push({
      hash: row.sha256,
      count: row.c,
      items: items.map((i) => ({ id: i.id, title: i.title, filePath: i.file_path, fileSize: i.file_size }))
    })
  }
  return groups
}

/** 设置视频标签（按名称数组整体替换，缺失标签自动创建；最多 10 个） */
export function setVideoTags(videoId: number, tagNames: string[]): void {
  const db = getDb()
  const names = [...new Set(tagNames.map((t) => t.trim()).filter(Boolean))].slice(0, 10)
  db.prepare('DELETE FROM video_tags WHERE video_id = ?').run(videoId)
  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)')
  const getTag = db.prepare('SELECT id FROM tags WHERE name = ?')
  const link = db.prepare('INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES (?, ?)')
  for (const name of names) {
    insertTag.run(name)
    const tag = getTag.get(name) as { id: number }
    link.run(videoId, tag.id)
  }
  // 标签属于元数据，同样更新保存时间
  db.prepare("UPDATE videos SET meta_updated_at = datetime('now','localtime') WHERE id = ?").run(videoId)
}

function rowToItem(r: Record<string, unknown>): VideoListItem {
  const width = (r.width as number | null) ?? null
  const height = (r.height as number | null) ?? null
  const orientation =
    width !== null && height !== null
      ? width > height
        ? 'landscape'
        : height > width
          ? 'portrait'
          : 'square'
      : 'square'
  // 解析历史文件名 JSON；空时以当前 file_name 兜底
  let moreFileNames: string[] = []
  try {
    const parsed = JSON.parse((r.more_file_names as string | null) ?? '[]') as unknown
    if (Array.isArray(parsed)) moreFileNames = parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    moreFileNames = []
  }
  const curName = (r.file_name as string) ?? ''
  if (moreFileNames.length === 0 && curName) moreFileNames = [curName]
  // 解析关键帧截图记录 JSON
  let keyframes: KeyframeShot[] = []
  try {
    const parsed = JSON.parse((r.keyframes as string | null) ?? '[]') as unknown
    if (Array.isArray(parsed)) {
      keyframes = parsed.filter(
        (x): x is KeyframeShot =>
          !!x &&
          typeof x === 'object' &&
          typeof (x as KeyframeShot).name === 'string' &&
          typeof (x as KeyframeShot).timeSec === 'number'
      )
    }
  } catch {
    keyframes = []
  }
  return {
    id: r.id as number,
    title: r.title as string,
    fileName: curName,
    moreFileNames,
    filePath: r.file_path as string,
    fileSize: r.file_size as number,
    duration: (r.duration as number) ?? null,
    fps: (r.fps as number | null) ?? null,
    frameCount: (r.frame_count as number | null) ?? null,
    keyframes,
    width,
    height,
    codec: (r.codec as string) ?? null,
    format: (r.format as string) ?? null,
    categoryId: (r.category_id as number | null) ?? null,
    category: (r.category as string) ?? null,
    tags: [],
    rating: (r.rating as number | null) ?? null,
    isFavorite: (r.is_favorite as number) ?? 0,
    thumbnailPath: (r.thumbnail_path as string | null) ?? null,
    dateAdded: r.date_added as string,
    status: r.status as string,
    remark: (r.remark as string | null) ?? null,
    author: ((r.author_name as string | null) ?? (r.author as string | null)) ?? null,
    authorId: (r.author_id as number | null) ?? null,
    orientation,
    sha256: (r.sha256 as string | null) ?? null,
    hashComputed: (r.hash_computed as number) ?? 0,
    playCount: (r.play_count as number) ?? 0,
    lastPlayedAt: (r.last_played_at as string | null) ?? null,
    metaUpdatedAt: (r.meta_updated_at as string | null) ?? null
  }
}

function attachTags(ids: number[], items: VideoListItem[]): void {
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(',')
  const rows = getDb()
    .prepare(
      `SELECT vt.video_id, t.name FROM video_tags vt JOIN tags t ON t.id = vt.tag_id
       WHERE vt.video_id IN (${placeholders}) ORDER BY t.name`
    )
    .all(...ids) as unknown as Array<{ video_id: number; name: string }>
  const byId = new Map<number, string[]>()
  for (const r of rows) {
    const list = byId.get(r.video_id) ?? []
    list.push(r.name)
    byId.set(r.video_id, list)
  }
  for (const item of items) item.tags = byId.get(item.id) ?? []
}

/** 单事务辅助（批量操作整体成功或整体回滚） */
function withTx<T>(fn: () => T): T {
  const db = getDb()
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw err
  }
}

/** 批量修改字段（收藏/评分/备注/分类/作者；分类/作者/备注 null = 清除） */
export function batchUpdateVideos(ids: number[], patch: BatchVideoPatch): BatchVideoResult {
  const list = [...new Set(ids.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))]
  if (list.length === 0) return { ok: true, updated: 0 }
  withTx(() => {
    for (const id of list) updateVideo(id, patch)
  })
  return { ok: true, updated: list.length }
}

/** 批量追加标签（与已有标签合并去重；标签必须已存在，沿用单条最多 10 个的上限） */
export function batchAppendTags(ids: number[], tagNames: string[]): BatchVideoResult {
  const list = [...new Set(ids.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))]
  if (list.length === 0) return { ok: true, updated: 0 }
  const names = [...new Set(tagNames.map((t) => String(t).trim()).filter(Boolean))]
  if (names.length === 0) return { ok: false, error: '未选择标签', updated: 0 }
  const db = getDb()
  const found = db
    .prepare(`SELECT name FROM tags WHERE name IN (${names.map(() => '?').join(',')})`)
    .all(...names) as unknown as Array<{ name: string }>
  const foundSet = new Set(found.map((f) => f.name))
  const missing = names.filter((n) => !foundSet.has(n))
  if (missing.length > 0) return { ok: false, error: `标签不存在：${missing.join('、')}`, updated: 0 }
  const currentRows = db
    .prepare(
      `SELECT vt.video_id, t.name FROM video_tags vt JOIN tags t ON t.id = vt.tag_id
       WHERE vt.video_id IN (${list.map(() => '?').join(',')})`
    )
    .all(...list) as unknown as Array<{ video_id: number; name: string }>
  const current = new Map<number, string[]>()
  for (const row of currentRows) {
    const arr = current.get(row.video_id) ?? []
    arr.push(row.name)
    current.set(row.video_id, arr)
  }
  withTx(() => {
    for (const id of list) {
      const union = [...new Set([...(current.get(id) ?? []), ...names])].slice(0, 10)
      setVideoTags(id, union)
    }
  })
  return { ok: true, updated: list.length }
}

/** 批量删除记录（与单条删除语义一致：deleteFile=true 时删除真实本地文件；封面/关键帧由 GC 清理） */
export function batchRemoveVideos(ids: number[], deleteFile: boolean): BatchRemoveResult {
  const list = [...new Set(ids.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))]
  if (list.length === 0) return { ok: true, removed: 0, deletedFiles: 0 }
  const db = getDb()
  const sel = db.prepare('SELECT id, file_path FROM videos WHERE id = ?')
  const del = db.prepare('DELETE FROM videos WHERE id = ?')
  let deletedFiles = 0
  withTx(() => {
    for (const id of list) {
      const row = sel.get(id) as { id: number; file_path: string } | undefined
      if (!row) continue
      if (
        deleteFile &&
        row.file_path &&
        !row.file_path.startsWith('restored://') &&
        existsSync(row.file_path)
      ) {
        try {
          rmSync(row.file_path, { force: true })
          deletedFiles++
        } catch {
          /* 文件删除失败不阻断记录移除 */
        }
      }
      del.run(id)
    }
  })
  return { ok: true, removed: list.length, deletedFiles }
}
