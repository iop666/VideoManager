import { getDb } from '../db'
import type {
  DuplicateGroup,
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
  const pageSize = Math.min(Math.max(1, query.pageSize || 50), 200)
  const search = (query.search ?? '').trim()
  const categoryId = query.categoryId ?? null
  const tagId = query.tagId ?? null
  const authorId = query.authorId ?? null
  const favorite = query.favorite ? 1 : 0
  const orientation = query.orientation ?? null
  const includeMissing = query.includeMissing === true
  const hideLocal = query.hideLocal === true
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
      `SELECT v.id, v.title, v.file_name, v.file_size, v.duration, v.width, v.height,
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
      `SELECT v.id, v.title, v.file_name, v.file_size, v.duration, v.width, v.height,
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
  return {
    id: r.id as number,
    title: r.title as string,
    fileName: r.file_name as string,
    filePath: r.file_path as string,
    fileSize: r.file_size as number,
    duration: (r.duration as number) ?? null,
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
