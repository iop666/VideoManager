/**
 * 备份恢复安全重构核心服务：
 *  - 备份文件完整性校验（loadZipManifest）
 *  - 恢复前差异分析（buildDiff：备份独有 / 本地独有 / 冲突 / 一致）
 *  - 四种恢复模式（full / backup-first / local-first / missing-only）
 *  - 恢复前自动快照 + 一键回滚（createSnapshot / rollbackToSnapshot）
 *  - SHA-256 引用计数与物理删除分离：孤儿封面/关键帧垃圾回收（sweepOrphanAssets）
 *  - 操作日志（restore_logs 表）
 *
 * 原则：恢复对数据库的改动是单个事务；封面/关键帧属可重建文件，写入失败仅警告。
 * 用户磁盘上的视频文件永不因恢复/GC 被删除。
 */
import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { unzipSync } from 'fflate'
import type { KeyframeShot } from '../../shared/types'
import type {
  RestoreDiffItem,
  RestoreExecuteResult,
  RestoreLog,
  RestoreMode,
  RestoreStats,
  RestoreSummary
} from '../../shared/types'
import { closeDatabase, getDb, getDbPath, getSetting, initDatabase } from '../db'

// ============ 目录与工具 ============

/** 缩略图（封面）目录：settings thumbnail_dir 或 userData/thumbnails */
function thumbDir(): string {
  return getSetting('thumbnail_dir') ?? join(app.getPath('userData'), 'thumbnails')
}

/** 关键帧目录：settings keyframe_dir 或 userData/keyframe（与 keyframes.ts 一致） */
function keyframeDir(): string {
  return getSetting('keyframe_dir') ?? join(app.getPath('userData'), 'keyframe')
}

/** 快照根目录（位于 userData 即软件目录 data/ 下） */
function snapshotsRoot(): string {
  return join(app.getPath('userData'), 'restore-snapshots')
}

/** 快照文件名时间戳（YYYYMMDD-HHmmss，本地时间） */
function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  )
}

const SHA_RE = /^[0-9a-f]{64}$/

// ============ 备份解析与完整性校验 ============

/** 备份条目规范化后的内部形态 */
export interface ParsedBackupEntry {
  sha256: string
  title: string
  fileNames: string[]
  category: { name: string; color: string | null } | null
  tags: Array<{ name: string; color: string | null }>
  author: { name: string; color: string | null } | null
  rating: number | null
  remark: string | null
  isFavorite: boolean
  /** 封面相对路径（zip 内），缺失时为空字符串 */
  imageRef: string
  keyframes: KeyframeShot[]
  sizeBytes: number
  duration: number | null
  fps: number | null
  frameCount: number | null
  width: number | null
  height: number | null
  codec: string | null
  format: string | null
  playCount: number
  firstAdded: string | null
}

export interface ZipManifest {
  ok: boolean
  error?: string
  zipPath: string
  legacy: boolean
  entries: ParsedBackupEntry[]
  duplicatesInBackup: number
  invalidEntries: number
  /** zip 内全部条目路径（含 data.json/images/keyframe） */
  zipPaths: Set<string>
}

function normalizeEntry(raw: unknown): ParsedBackupEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const sha = typeof item.sha256 === 'string' ? item.sha256.trim().toLowerCase() : ''
  if (!SHA_RE.test(sha)) return null

  // 历史文件名（新格式 MorefileNames 数组；旧格式 fileName 字符串）
  let fileNames: string[] = []
  if (Array.isArray(item.MorefileNames)) {
    fileNames = item.MorefileNames.filter((n): n is string => typeof n === 'string' && n.trim() !== '')
  } else if (typeof item.fileName === 'string' && item.fileName.trim() !== '') {
    fileNames = [item.fileName]
  }

  const catRaw = item.category
  let category: { name: string; color: string | null } | null = null
  if (typeof catRaw === 'string' && catRaw.trim()) category = { name: catRaw.trim(), color: null }
  else if (catRaw && typeof catRaw === 'object') {
    const c = catRaw as Record<string, unknown>
    if (typeof c.name === 'string' && c.name.trim()) {
      category = { name: c.name.trim(), color: typeof c.color === 'string' ? c.color : null }
    }
  }

  const autRaw = item.author
  let author: { name: string; color: string | null } | null = null
  if (typeof autRaw === 'string' && autRaw.trim()) author = { name: autRaw.trim(), color: null }
  else if (autRaw && typeof autRaw === 'object') {
    const a = autRaw as Record<string, unknown>
    if (typeof a.name === 'string' && a.name.trim()) {
      author = { name: a.name.trim(), color: typeof a.color === 'string' ? a.color : null }
    }
  }

  const tags: Array<{ name: string; color: string | null }> = []
  if (Array.isArray(item.tags)) {
    for (const t of item.tags) {
      if (typeof t === 'string' && t.trim()) tags.push({ name: t.trim(), color: null })
      else if (t && typeof t === 'object') {
        const tt = t as Record<string, unknown>
        if (typeof tt.name === 'string' && tt.name.trim()) {
          tags.push({ name: tt.name.trim(), color: typeof tt.color === 'string' ? tt.color : null })
        }
      }
    }
  }

  // 关键帧记录
  let keyframes: KeyframeShot[] = []
  if (Array.isArray(item.keyframes)) {
    keyframes = item.keyframes.filter(
      (x): x is KeyframeShot =>
        !!x &&
        typeof x === 'object' &&
        typeof (x as KeyframeShot).name === 'string' &&
        typeof (x as KeyframeShot).timeSec === 'number'
    )
  }

  // 视频信息
  const vi = (item.videoInfo && typeof item.videoInfo === 'object'
    ? (item.videoInfo as Record<string, unknown>)
    : {}) as Record<string, unknown>
  const res = (vi.resolution && typeof vi.resolution === 'object'
    ? (vi.resolution as Record<string, unknown>)
    : {}) as Record<string, unknown>
  const ts = (item.timestamps && typeof item.timestamps === 'object'
    ? (item.timestamps as Record<string, unknown>)
    : {}) as Record<string, unknown>

  return {
    sha256: sha,
    title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : '(未命名)',
    fileNames,
    category,
    tags,
    author,
    rating: typeof item.rating === 'number' ? item.rating : null,
    remark: typeof item.remark === 'string' ? item.remark : null,
    isFavorite: item.isFavorite === true,
    imageRef: typeof item.image === 'string' && item.image.startsWith('images/') ? item.image : '',
    keyframes,
    sizeBytes: typeof vi.sizeBytes === 'number' ? vi.sizeBytes : 0,
    duration: typeof vi.durationSeconds === 'number' ? vi.durationSeconds : null,
    fps: typeof vi.fps === 'number' ? vi.fps : null,
    frameCount: typeof vi.frameCount === 'number' ? vi.frameCount : null,
    width: typeof res.width === 'number' ? res.width : null,
    height: typeof res.height === 'number' ? res.height : null,
    codec: typeof vi.codec === 'string' ? vi.codec : null,
    format: typeof vi.format === 'string' ? vi.format : null,
    playCount: typeof vi.playCount === 'number' ? vi.playCount : 0,
    firstAdded: typeof ts.firstAdded === 'string' ? ts.firstAdded : null
  }
}

/**
 * 读取备份 zip 并做基础完整性校验（不写盘、无副作用）：
 *  - zip 可完整解压；data.json 存在且 JSON 合法
 *  - 每条记录 sha256 为 64 位 hex；备份内重复条目自动去重并计数
 *  - 记录 image/keyframe 引用是否在 zip 内存在（缺失仅统计，不致命）
 */
export function loadZipManifest(zipPath: string): ZipManifest {
  const base: ZipManifest = {
    ok: false,
    zipPath,
    legacy: false,
    entries: [],
    duplicatesInBackup: 0,
    invalidEntries: 0,
    zipPaths: new Set()
  }
  let buf: Uint8Array
  try {
    buf = new Uint8Array(readFileSync(zipPath))
  } catch (err) {
    return { ...base, error: `无法读取备份文件：${err instanceof Error ? err.message : String(err)}` }
  }
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(buf)
  } catch (err) {
    return { ...base, error: `备份文件损坏或不是有效的 ZIP：${err instanceof Error ? err.message : String(err)}` }
  }
  base.zipPaths = new Set(Object.keys(files))

  const dataEntry = files['data.json']
  if (!dataEntry) return { ...base, error: '备份中缺少 data.json' }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(dataEntry))
  } catch (err) {
    return { ...base, error: `data.json 解析失败：${err instanceof Error ? err.message : String(err)}` }
  }

  // 新格式 { meta, videos[] }；旧格式为裸数组
  const rawItems: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as Record<string, unknown>).videos)
      ? ((parsed as Record<string, unknown>).videos as unknown[])
      : []
  const legacy = Array.isArray(parsed)
  if (rawItems.length === 0) {
    return { ...base, error: '备份中没有任何视频条目（videos 为空）' }
  }

  const seen = new Set<string>()
  let duplicates = 0
  let invalid = 0
  const entries: ParsedBackupEntry[] = []
  for (const raw of rawItems) {
    const entry = normalizeEntry(raw)
    if (!entry) {
      invalid++
      continue
    }
    if (seen.has(entry.sha256)) {
      duplicates++
      continue
    }
    seen.add(entry.sha256)
    entries.push(entry)
  }
  if (entries.length === 0) {
    return { ...base, error: '备份中没有有效条目（所有记录均缺少合法 SHA-256）' }
  }
  return { ...base, ok: true, legacy, entries, duplicatesInBackup: duplicates, invalidEntries: invalid }
}

// ============ 差异分析 ============

interface LocalRow {
  id: number
  sha256: string
  title: string
  category: string | null
  author: string | null
  rating: number | null
  remark: string | null
  isFavorite: boolean
  tags: string[]
}

/** 加载本地库中全部已建立身份的记录（同 sha256 多行时优先真实路径行） */
function loadLocalRows(): Map<string, LocalRow> {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT v.id, v.sha256, v.title, v.rating, v.remark, v.is_favorite, v.file_path,
              c.name AS category, a.name AS author
       FROM videos v
       LEFT JOIN categories c ON c.id = v.category_id
       LEFT JOIN authors a ON a.id = v.author_id
       WHERE v.sha256 IS NOT NULL AND v.sha256 != ''
       ORDER BY CASE WHEN v.file_path LIKE 'restored://%' THEN 1 ELSE 0 END, v.id`
    )
    .all() as unknown as Array<{
    id: number
    sha256: string
    title: string
    rating: number | null
    remark: string | null
    isFavorite: number
    file_path: string
    category: string | null
    author: string | null
  }>
  const map = new Map<string, LocalRow>()
  for (const r of rows) {
    if (!map.has(r.sha256)) {
      map.set(r.sha256, {
        id: r.id,
        sha256: r.sha256,
        title: r.title,
        category: r.category,
        author: r.author,
        rating: r.rating,
        remark: r.remark,
        isFavorite: r.isFavorite === 1,
        tags: []
      })
    }
  }
  const tagRows = db
    .prepare(
      `SELECT v.sha256, t.name FROM video_tags vt
       JOIN videos v ON v.id = vt.video_id
       JOIN tags t ON t.id = vt.tag_id
       WHERE v.sha256 IS NOT NULL AND v.sha256 != ''`
    )
    .all() as unknown as Array<{ sha256: string; name: string }>
  for (const t of tagRows) {
    const row = map.get(t.sha256)
    if (row && !row.tags.includes(t.name)) row.tags.push(t.name)
  }
  return map
}

function compareLocalWithBackup(local: LocalRow, e: ParsedBackupEntry): string[] {
  const fields: string[] = []
  const catName = e.category?.name ?? null
  const autName = e.author?.name ?? null
  const backupTags = [...new Set(e.tags.map((t) => t.name))].sort()
  const localTags = [...local.tags].sort()
  if (local.title !== e.title) fields.push('title')
  if ((local.category ?? null) !== catName) fields.push('category')
  if ((local.author ?? null) !== autName) fields.push('author')
  if (localTags.join('\u0000') !== backupTags.join('\u0000')) fields.push('tags')
  if (local.rating !== e.rating) fields.push('rating')
  if ((local.remark ?? null) !== (e.remark ?? null)) fields.push('remark')
  if (local.isFavorite !== e.isFavorite) fields.push('favorite')
  return fields
}

export interface RestoreDiff {
  summary: RestoreSummary
  items: RestoreDiffItem[]
  /** sha256 → 差异类别（执行阶段按模式决定动作，避免清空后重算失真） */
  kindBySha: Map<string, 'backupOnly' | 'conflict' | 'identical'>
}

/** 备份与本地库差异分析（只读） */
export function buildDiff(manifest: ZipManifest): RestoreDiff {
  const localMap = loadLocalRows()
  const localOnly = new Set(localMap.keys())
  const items: RestoreDiffItem[] = []
  const kindBySha = new Map<string, 'backupOnly' | 'conflict' | 'identical'>()
  let missingCovers = 0
  let conflicts = 0
  let identical = 0

  for (const e of manifest.entries) {
    localOnly.delete(e.sha256)
    // 封面引用存在性（备份声明了图片但 zip 内缺失 → 计入缺失）
    if (e.imageRef && !manifest.zipPaths.has(e.imageRef)) missingCovers++
    const local = localMap.get(e.sha256)
    if (!local) {
      items.push({
        kind: 'backupOnly',
        sha256: e.sha256,
        backupTitle: e.title,
        localTitle: null,
        backupCategory: e.category?.name ?? null,
        localCategory: null,
        backupTags: e.tags.map((t) => t.name),
        localTags: [],
        backupAuthor: e.author?.name ?? null,
        localAuthor: null,
        conflictFields: []
      })
      kindBySha.set(e.sha256, 'backupOnly')
      continue
    }
    const diffFields = compareLocalWithBackup(local, e)
    const kind = diffFields.length === 0 ? 'identical' : 'conflict'
    kindBySha.set(e.sha256, kind)
    if (kind === 'identical') identical++
    else conflicts++
    items.push({
      kind,
      sha256: e.sha256,
      backupTitle: e.title,
      localTitle: local.title,
      backupCategory: e.category?.name ?? null,
      localCategory: local.category,
      backupTags: e.tags.map((t) => t.name),
      localTags: local.tags,
      backupAuthor: e.author?.name ?? null,
      localAuthor: local.author,
      conflictFields: diffFields
    })
  }

  for (const sha of localOnly) {
    const local = localMap.get(sha)
    if (!local) continue
    items.push({
      kind: 'localOnly',
      sha256: sha,
      backupTitle: null,
      localTitle: local.title,
      backupCategory: null,
      localCategory: local.category,
      backupTags: [],
      localTags: local.tags,
      backupAuthor: null,
      localAuthor: local.author,
      conflictFields: []
    })
  }

  // 汇总（backupOnly 数量 = items 中类别计数）
  const backupOnlyCount = items.filter((i) => i.kind === 'backupOnly').length
  const summary: RestoreSummary = {
    backupTotal: manifest.entries.length,
    duplicatesInBackup: manifest.duplicatesInBackup,
    invalidEntries: manifest.invalidEntries,
    localTotal: localMap.size,
    backupOnly: backupOnlyCount,
    localOnly: items.filter((i) => i.kind === 'localOnly').length,
    conflict: conflicts,
    identical,
    missingCovers,
    legacy: manifest.legacy
  }
  return { summary, items, kindBySha }
}

// ============ 执行恢复 ============

/** 分类/作者/标签按名 upsert 并写颜色（复用 metaIO 的策略） */
function upsertCategory(db: ReturnType<typeof getDb>, name: string, color: string | null): number {
  db.prepare('INSERT OR IGNORE INTO categories (name, color) VALUES (?, ?)').run(name, color)
  db.prepare('UPDATE categories SET color = COALESCE(?, color) WHERE name = ?').run(color, name)
  return (db.prepare('SELECT id FROM categories WHERE name = ?').get(name) as { id: number }).id
}

function upsertAuthor(db: ReturnType<typeof getDb>, name: string, color: string | null): number {
  db.prepare('INSERT OR IGNORE INTO authors (name, color) VALUES (?, ?)').run(name, color)
  db.prepare('UPDATE authors SET color = COALESCE(?, color) WHERE name = ?').run(color, name)
  return (db.prepare('SELECT id FROM authors WHERE name = ?').get(name) as { id: number }).id
}

function setTagsForVideo(db: ReturnType<typeof getDb>, videoId: number, tags: Array<{ name: string; color: string | null }>): void {
  const names = [...new Set(tags.map((t) => t.name.trim()).filter(Boolean))].slice(0, 10)
  db.prepare('DELETE FROM video_tags WHERE video_id = ?').run(videoId)
  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)')
  const getTag = db.prepare('SELECT id FROM tags WHERE name = ?')
  const link = db.prepare('INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES (?, ?)')
  for (const name of names) {
    const tag = tags.find((t) => t.name === name)
    const color = tag?.color ?? null
    insertTag.run(name, color)
    const tagId = (getTag.get(name) as { id: number }).id
    db.prepare('UPDATE tags SET color = COALESCE(?, color) WHERE id = ?').run(color, tagId)
    link.run(videoId, tagId)
  }
}

/** 读取某 sha256 的全部行 id（可能多条：占位 + 真实路径） */
function rowIdsBySha(db: ReturnType<typeof getDb>, sha256: string): number[] {
  return (db.prepare('SELECT id FROM videos WHERE sha256 = ?').all(sha256) as unknown as Array<{ id: number }>).map(
    (r) => r.id
  )
}

/** 插入一条备份记录（restored:// 占位；恢复数据不含路径，重扫后自动认领真实文件） */
function applyInsert(db: ReturnType<typeof getDb>, e: ParsedBackupEntry): void {
  const firstFileName = e.fileNames[0] ?? ''
  const placeholderPath = `restored://${e.sha256}`
  const ins = db
    .prepare(
      `INSERT OR IGNORE INTO videos
         (title, file_path, file_name, more_file_names, file_size, duration, fps, frame_count,
          keyframes, width, height, codec, format, sha256, hash_computed, date_added, status,
          is_favorite, play_count, rating, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, COALESCE(?, datetime('now','localtime')), 'ready', ?, ?, ?, ?)`
    )
    .run(
      e.title || '(未命名)',
      placeholderPath,
      firstFileName,
      JSON.stringify(e.fileNames),
      e.sizeBytes,
      e.duration,
      e.fps,
      e.frameCount,
      JSON.stringify(e.keyframes),
      e.width,
      e.height,
      e.codec,
      e.format,
      e.sha256,
      e.firstAdded,
      e.isFavorite ? 1 : 0,
      e.playCount,
      e.rating,
      e.remark
    )
  if (Number(ins.lastInsertRowid) <= 0) {
    // 极端冲突：占位路径已存在
    const anyRow = db
      .prepare('SELECT id FROM videos WHERE file_path = ? ORDER BY id LIMIT 1')
      .get(placeholderPath) as { id: number } | undefined
    if (anyRow) applyUpdate(db, e, anyRow.id)
    return
  }
  applyCategoryAuthorTags(db, e.sha256, e)
}

/** 覆盖更新（backup-first 冲突）：用户可编辑字段用备份值；媒体/播放/时间等本地观测保留 */
function applyUpdate(db: ReturnType<typeof getDb>, e: ParsedBackupEntry, forcedId?: number): void {
  const ids = forcedId ? [forcedId] : rowIdsBySha(db, e.sha256)
  if (ids.length === 0) {
    applyInsert(db, e)
    return
  }
  // 合并历史文件名（本地 ∪ 备份）
  const anyRow = db.prepare('SELECT more_file_names, file_name, keyframes, fps, frame_count, duration, file_size FROM videos WHERE id = ?').get(ids[0]) as
    | { more_file_names: string | null; file_name: string | null; keyframes: string | null; fps: number | null; frame_count: number | null; duration: number | null; file_size: number }
    | undefined
  let mergedNames: string[] = []
  try {
    const parsed = JSON.parse(anyRow?.more_file_names ?? '[]') as unknown
    if (Array.isArray(parsed)) mergedNames = parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    mergedNames = []
  }
  const curName = anyRow?.file_name ?? ''
  if (curName && !mergedNames.includes(curName)) mergedNames.push(curName)
  for (const n of e.fileNames) if (!mergedNames.includes(n)) mergedNames.push(n)

  const categoryId = e.category ? upsertCategory(db, e.category.name, e.category.color) : null
  const authorId = e.author ? upsertAuthor(db, e.author.name, e.author.color) : null

  const upd = db.prepare(
    `UPDATE videos SET
       title = ?, category_id = ?, author_id = ?, rating = ?, remark = ?, is_favorite = ?,
       more_file_names = ?,
       fps = COALESCE(fps, ?), frame_count = COALESCE(frame_count, ?),
       duration = COALESCE(duration, ?), file_size = CASE WHEN file_size = 0 THEN ? ELSE file_size END,
       keyframes = CASE WHEN keyframes IS NULL OR keyframes = '[]' THEN ? ELSE keyframes END,
       file_name = CASE WHEN file_name IS NULL OR file_name = '' THEN ? ELSE file_name END,
       meta_updated_at = datetime('now','localtime')
     WHERE id = ?`
  )
  for (const id of ids) {
    upd.run(
      e.title || '(未命名)',
      categoryId,
      authorId,
      e.rating,
      e.remark,
      e.isFavorite ? 1 : 0,
      JSON.stringify(mergedNames),
      e.fps,
      e.frameCount,
      e.duration,
      e.sizeBytes,
      JSON.stringify(e.keyframes),
      e.fileNames[0] ?? '',
      id
    )
    setTagsForVideo(db, id, e.tags)
  }
}

/** 为某 sha256 的全部行写入分类/作者/标签 */
function applyCategoryAuthorTags(db: ReturnType<typeof getDb>, sha256: string, e: ParsedBackupEntry): void {
  const ids = rowIdsBySha(db, sha256)
  if (ids.length === 0) return
  const categoryId = e.category ? upsertCategory(db, e.category.name, e.category.color) : null
  const authorId = e.author ? upsertAuthor(db, e.author.name, e.author.color) : null
  db.prepare('UPDATE videos SET category_id = ?, author_id = ? WHERE sha256 = ?').run(categoryId, authorId, sha256)
  for (const id of ids) setTagsForVideo(db, id, e.tags)
}

/** 恢复模式 → 条目动作 */
function actionFor(mode: RestoreMode, kind: 'backupOnly' | 'conflict' | 'identical'): 'insert' | 'update' | 'skip' {
  switch (mode) {
    case 'full':
      // 库已清空，全部按备份重建
      return 'insert'
    case 'backup-first':
      return kind === 'backupOnly' ? 'insert' : kind === 'conflict' ? 'update' : 'skip'
    case 'local-first':
    case 'missing-only':
      return kind === 'backupOnly' ? 'insert' : 'skip'
  }
}

/** 事务内应用备份条目（全有或全无；任何异常整体回滚） */
function applyEntriesTx(
  mode: RestoreMode,
  entries: ParsedBackupEntry[],
  kindBySha: Map<string, 'backupOnly' | 'conflict' | 'identical'>
): { inserted: number; updated: number; removed: number; skipped: number; detail: Array<{ sha256: string; action: string }> } {
  const db = getDb()
  let removed = 0
  let inserted = 0
  let updated = 0
  let skipped = 0
  const detail: Array<{ sha256: string; action: string }> = []
  db.exec('BEGIN IMMEDIATE')
  try {
    if (mode === 'full') {
      removed = (db.prepare('SELECT COUNT(*) AS c FROM videos').get() as { c: number }).c
      db.prepare('DELETE FROM video_tags').run()
      db.prepare('DELETE FROM videos').run()
    }
    const hasRow = db.prepare('SELECT id FROM videos WHERE sha256 = ? LIMIT 1')
    for (const e of entries) {
      const kind = kindBySha.get(e.sha256) ?? 'backupOnly'
      const action = actionFor(mode, kind)
      if (action === 'skip') {
        skipped++
        continue
      }
      const exists = hasRow.get(e.sha256) as { id: number } | undefined
      if (action === 'insert' && !exists) {
        applyInsert(db, e)
        inserted++
        detail.push({ sha256: e.sha256, action: 'insert' })
      } else if (action === 'insert' && exists) {
        // 计划插入但库中已有同指纹行（罕见）：升级为覆盖更新，保证备份值生效
        applyUpdate(db, e)
        updated++
        detail.push({ sha256: e.sha256, action: 'update' })
      } else if (action === 'update') {
        applyUpdate(db, e)
        updated++
        detail.push({ sha256: e.sha256, action: 'update' })
      }
    }
    db.exec('COMMIT')
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw err
  }
  return { inserted, updated, removed, skipped, detail }
}

/** 把备份 zip 中的封面与关键帧写回对应目录（可重建文件，失败仅计数警告） */
async function writeBackupAssets(zipPath: string): Promise<{ covers: number; coversFailed: number; keyframes: number; keyframesFailed: number }> {
  const buf = new Uint8Array(readFileSync(zipPath))
  const files = unzipSync(buf)
  const tdir = thumbDir()
  const kdir = keyframeDir()
  mkdirSync(tdir, { recursive: true })
  mkdirSync(kdir, { recursive: true })
  let covers = 0
  let coversFailed = 0
  let keyframes = 0
  let keyframesFailed = 0
  const IMG_RE = /^images\/([0-9a-f]{64})\.jpg$/i
  const KF_RE = /^keyframe\/(Keyframe_[0-9a-f]{64}_\d+\.jpg)$/i
  for (const [p, data] of Object.entries(files)) {
    try {
      if (IMG_RE.test(p)) {
        writeFileSync(join(tdir, basename(p)), Buffer.from(data))
        covers++
      } else if (KF_RE.test(p)) {
        writeFileSync(join(kdir, basename(p)), Buffer.from(data))
        keyframes++
      }
    } catch {
      if (/^images\//i.test(p)) coversFailed++
      else if (/^keyframe\//i.test(p)) keyframesFailed++
    }
  }
  return { covers, coversFailed, keyframes, keyframesFailed }
}

/**
 * 封面路径回填：恢复写回的封面位于 thumbnails/<sha256>.jpg，
 * 为库中"尚无 thumbnail_path"的记录补上该路径（占位重建/覆盖更新/原本一致的记录均受益），
 * 使恢复出的记录在视频库/详情页能立即显示封面。
 */
function backfillThumbnailPaths(entries: ParsedBackupEntry[]): number {
  const db = getDb()
  const tdir = thumbDir()
  const upd = db.prepare(
    "UPDATE videos SET thumbnail_path = ? WHERE sha256 = ? AND (thumbnail_path IS NULL OR thumbnail_path = '')"
  )
  let n = 0
  for (const e of entries) {
    const p = join(tdir, `${e.sha256}.jpg`)
    try {
      if (existsSync(p)) {
        const r = upd.run(p, e.sha256)
        n += Number(r.changes)
      }
    } catch {
      /* 单条失败跳过 */
    }
  }
  return n
}

// ============ 快照 / 回滚 ============

/** 创建唯一快照目录：秒级时间戳若与既有目录冲突（同秒连续恢复）则追加序号重试 */
function createSnapshotDir(root: string): string {
  for (let i = 0; i < 50; i++) {
    const name = i === 0 ? `restore-${stamp()}` : `restore-${stamp()}-${i}`
    const dir = join(root, name)
    try {
      mkdirSync(dir)
      return dir
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code !== 'EEXIST') throw err
      // 同秒冲突：下一轮换后缀
    }
  }
  throw new Error('无法创建唯一快照目录')
}

/**
 * 执行任何破坏性操作前的数据库快照（wal_checkpoint 后复制主库文件；图片目录共享不复制）。
 * info.json 额外记录快照时刻的全部 SHA-256 引用集（refs）——GC 据此保护"现存快照仍引用"的
 * 封面/关键帧不被清理，保证任意回滚到该快照时图片仍然完整。
 */
export function createSnapshot(mode: RestoreMode, backupFile: string, summary: RestoreSummary | null): string | null {
  try {
    const root = snapshotsRoot()
    mkdirSync(root, { recursive: true })
    const dir = createSnapshotDir(root)
    getDb().exec('PRAGMA wal_checkpoint(TRUNCATE)')
    copyFileSync(getDbPath(), join(dir, 'videomanager.db'))
    const beforeCount = (getDb().prepare('SELECT COUNT(*) AS c FROM videos').get() as { c: number }).c
    const refs = (getDb()
      .prepare("SELECT DISTINCT sha256 FROM videos WHERE sha256 IS NOT NULL AND sha256 != ''")
      .all() as unknown as Array<{ sha256: string }>).map((r) => r.sha256)
    const info = {
      kind: 'restore-snapshot',
      createdAt: new Date().toLocaleString('zh-CN'),
      mode,
      backupFile,
      beforeCount,
      refs,
      summary
    }
    writeFileSync(join(dir, 'info.json'), JSON.stringify(info, null, 2))
    pruneSnapshots()
    return dir
  } catch (err) {
    console.error('[videomanager] 恢复快照创建失败（该次恢复将无法回滚）:', err)
    return null
  }
}

/** 快照保留策略：仅保留最近 20 份 */
function pruneSnapshots(): void {
  try {
    const root = snapshotsRoot()
    const dirs = readdirSync(root)
      .filter((d) => d.startsWith('restore-'))
      .map((d) => join(root, d))
      .filter((d) => existsSync(join(d, 'videomanager.db')))
      .sort((a, b) => (a < b ? -1 : 1))
    while (dirs.length > 20) {
      const old = dirs.shift()
      if (old) rmSync(old, { recursive: true, force: true })
    }
  } catch {
    /* ignore */
  }
}

/** 收集所有现存快照 info.json 中的引用集（保护这些 sha 的图片不被 GC 清理） */
function collectSnapshotRefs(): Set<string> {
  const refs = new Set<string>()
  try {
    const root = snapshotsRoot()
    if (!existsSync(root)) return refs
    for (const d of readdirSync(root)) {
      if (!d.startsWith('restore-')) continue
      const infoPath = join(root, d, 'info.json')
      try {
        if (!existsSync(infoPath)) continue
        const info = JSON.parse(readFileSync(infoPath, 'utf8')) as { refs?: string[] }
        if (Array.isArray(info.refs)) {
          for (const sha of info.refs) {
            if (typeof sha === 'string' && SHA_RE.test(sha)) refs.add(sha)
          }
        }
      } catch {
        /* 单个快照损坏不影响 */
      }
    }
  } catch {
    /* ignore */
  }
  return refs
}

/**
 * 回滚到指定快照：替换数据库文件并重新初始化。
 * 注意：回滚**不执行孤儿图片清理**——图片目录为各快照共享，回滚本身绝不删除任何图片，
 * 保证回滚到任意深度的快照时其引用的封面/关键帧都还在（孤儿文件会在下次正向恢复/删除时统一清理）。
 */
export function rollbackToSnapshot(snapshotDir: string): { ok: boolean; error?: string } {
  const dbFile = join(snapshotDir, 'videomanager.db')
  if (!existsSync(dbFile)) return { ok: false, error: '快照不存在或已损坏' }
  try {
    closeDatabase()
    const target = getDbPath()
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        rmSync(target + suffix, { force: true })
      } catch {
        /* ignore */
      }
    }
    copyFileSync(dbFile, target)
    initDatabase()
  } catch (err) {
    // 尽力恢复连接，避免应用后续操作全部失败
    try {
      initDatabase()
    } catch {
      /* ignore */
    }
    return { ok: false, error: `回滚失败：${err instanceof Error ? err.message : String(err)}` }
  }
  return { ok: true }
}

/**
 * 按恢复日志回滚到其快照（UI/IPC 入口）。
 * 回滚用快照替换整个数据库；为保证审计链与连续回滚能力：
 *  - 回滚前收集当前库全部 restore_logs，回滚后把「快照库中不存在」的日志行合并回去
 *    （其中被回滚的那一行标记为 rolled_back），并追加一条 rollback 审计行；
 *  - 图片目录为快照共享且回滚不清理，回滚到任意深度时图片仍然完整。
 */
export function rollbackByLogId(logId: number): { ok: boolean; error?: string } {
  const row = getDb().prepare('SELECT * FROM restore_logs WHERE id = ?').get(logId) as
    | {
        snapshot_dir: string | null
        result: string
        mode: string | null
        backup_file: string | null
        summary: string | null
        stats: string | null
        detail: string | null
        created_at: string | null
        error: string | null
        elapsed_ms: number | null
      }
    | undefined
  if (!row) return { ok: false, error: '恢复记录不存在' }
  if (!row.snapshot_dir) return { ok: false, error: '该记录没有可回滚的快照（恢复失败或未生成快照）' }
  if (row.result === 'rolled_back') return { ok: false, error: '该恢复已完成回滚' }
  if (!existsSync(join(row.snapshot_dir, 'videomanager.db'))) {
    return { ok: false, error: '快照不存在或已损坏' }
  }
  // 1) 回滚前收集当前库全部日志行（回滚后要合并回去，保证历史不丢）
  const curRows = getDb()
    .prepare('SELECT * FROM restore_logs ORDER BY id')
    .all() as unknown as Array<Record<string, unknown>>
  const targetSnapshot = row.snapshot_dir

  // 2) 替换数据库（不做孤儿图片清理）
  const rb = rollbackToSnapshot(targetSnapshot)
  if (!rb.ok) return rb

  // 3) 日志合并：快照库已存在的 id 跳过；其余按原样插入，被回滚行标记 rolled_back
  try {
    const newDb = getDb()
    const existing = new Set(
      (newDb.prepare('SELECT id FROM restore_logs').all() as unknown as Array<{ id: number }>).map((r) => r.id)
    )
    const ins = newDb.prepare(
      `INSERT INTO restore_logs
         (id, created_at, kind, mode, backup_file, snapshot_dir, summary, stats, detail, result, error, elapsed_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const r of curRows) {
      const id = r.id as number
      if (existing.has(id)) continue
      const isTarget = r.snapshot_dir === targetSnapshot
      ins.run(
        id,
        (r.created_at as string) ?? null,
        (r.kind as string) ?? 'restore',
        (r.mode as string | null) ?? null,
        (r.backup_file as string | null) ?? null,
        (r.snapshot_dir as string | null) ?? null,
        (r.summary as string | null) ?? null,
        (r.stats as string | null) ?? null,
        (r.detail as string | null) ?? null,
        isTarget ? 'rolled_back' : ((r.result as string) ?? 'ok'),
        (r.error as string | null) ?? null,
        (r.elapsed_ms as number | null) ?? null
      )
      if (isTarget) existing.add(id)
    }
    // 4) 追加回滚审计行（携带原恢复信息）
    insertRestoreLog({
      kind: 'rollback',
      mode: (row.mode as RestoreMode | null) ?? null,
      backupFile: row.backup_file,
      snapshotDir: targetSnapshot,
      summary: parseJsonField<RestoreSummary>(row.summary),
      stats: parseJsonField<RestoreStats>(row.stats),
      detail: parseJsonField<Array<{ sha256: string; action: string }>>(row.detail) ?? undefined,
      result: 'ok',
      elapsedMs: 0
    })
  } catch {
    /* 日志合并失败不影响回滚结果 */
  }
  return { ok: true }
}

// ============ 孤儿资产垃圾回收（引用计数） ============

/**
 * 以 SHA-256 引用计数为基准清理孤儿封面/关键帧：
 * 文件名即 sha256（封面 <sha256>.jpg / 关键帧 Keyframe_<sha256>_NN.jpg）。
 * 保留集 = 当前库全部 sha256 ∪ 现存快照 info.json 中记录的引用集
 * （后者保证：快照仍可回滚到的记录，其图片绝不在此被清理）。
 * 仅删除命名匹配本程序格式的文件，绝不触碰其它文件。返回删除数量。
 */
export function sweepOrphanAssets(): number {
  const db = getDb()
  const refs = new Set<string>()
  const rows = db
    .prepare("SELECT DISTINCT sha256 FROM videos WHERE sha256 IS NOT NULL AND sha256 != ''")
    .all() as unknown as Array<{ sha256: string }>
  for (const r of rows) refs.add(r.sha256)
  for (const sha of collectSnapshotRefs()) refs.add(sha)
  let removed = 0
  const tryRemove = (dir: string, file: string): void => {
    try {
      rmSync(join(dir, file), { force: true })
      removed++
    } catch {
      /* ignore */
    }
  }
  const tdir = thumbDir()
  if (existsSync(tdir)) {
    for (const f of readdirSync(tdir)) {
      const m = /^([0-9a-f]{64})\.jpg$/i.exec(f)
      if (m && !refs.has(m[1].toLowerCase())) tryRemove(tdir, f)
    }
  }
  const kdir = keyframeDir()
  if (existsSync(kdir)) {
    for (const f of readdirSync(kdir)) {
      const m = /^Keyframe_([0-9a-f]{64})_\d+\.jpg$/i.exec(f)
      if (m && !refs.has(m[1].toLowerCase())) tryRemove(kdir, f)
    }
  }
  return removed
}

// ============ 日志 ============

interface LogRecord {
  kind: 'restore' | 'rollback'
  mode?: RestoreMode | null
  backupFile?: string | null
  snapshotDir?: string | null
  summary?: RestoreSummary | null
  stats?: RestoreStats | null
  detail?: Array<{ sha256: string; action: string }>
  result: 'ok' | 'failed' | 'rolled_back'
  error?: string | null
  elapsedMs?: number | null
}

export function insertRestoreLog(rec: LogRecord): number {
  const res = getDb()
    .prepare(
      `INSERT INTO restore_logs (kind, mode, backup_file, snapshot_dir, summary, stats, detail, result, error, elapsed_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      rec.kind,
      rec.mode ?? null,
      rec.backupFile ?? null,
      rec.snapshotDir ?? null,
      rec.summary ? JSON.stringify(rec.summary) : null,
      rec.stats ? JSON.stringify(rec.stats) : null,
      rec.detail && rec.detail.length > 0 ? JSON.stringify(rec.detail) : null,
      rec.result,
      rec.error ?? null,
      rec.elapsedMs ?? null
    )
  return Number(res.lastInsertRowid)
}

/** 最近恢复/回滚日志 */
export function listRestoreLogs(limit = 50): RestoreLog[] {
  const rows = getDb()
    .prepare('SELECT * FROM restore_logs ORDER BY id DESC LIMIT ?')
    .all(Math.min(Math.max(1, limit), 200)) as unknown as Array<Record<string, unknown>>
  return rows.map((r) => ({
    id: r.id as number,
    createdAt: (r.created_at as string) ?? '',
    kind: (r.kind as 'restore' | 'rollback') ?? 'restore',
    mode: (r.mode as RestoreMode | null) ?? null,
    backupFile: (r.backup_file as string | null) ?? null,
    snapshotDir: (r.snapshot_dir as string | null) ?? null,
    summary: parseJsonField<RestoreSummary>(r.summary),
    stats: parseJsonField<RestoreStats>(r.stats),
    result: (r.result as 'ok' | 'failed' | 'rolled_back') ?? 'ok',
    error: (r.error as string | null) ?? null,
    elapsedMs: (r.elapsed_ms as number | null) ?? null
  }))
}

function parseJsonField<T>(raw: unknown): T | null {
  if (typeof raw !== 'string' || !raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

// ============ 主执行入口 ============

export interface ExecuteRestoreOptions {
  zipPath: string
  mode: RestoreMode
  manifest: ZipManifest
  kindBySha: Map<string, 'backupOnly' | 'conflict' | 'identical'>
  summary: RestoreSummary
}

/**
 * 执行恢复：快照 → 图片写回（先写盘，DB 失败时仅多出可重建/可清理的文件）→ DB 事务 → 封面回填 → GC → 日志。
 * 顺序要点：图片在 DB 事务前写回可避免"DB 已提交但解压失败"的半状态；
 * 封面 thumbnail_path 在事务提交后按"图片实际存在"统一回填（占位/更新/一致记录都会受益）。
 */
export async function executeRestore(opts: ExecuteRestoreOptions): Promise<RestoreExecuteResult> {
  const started = Date.now()
  const { zipPath, mode, manifest, kindBySha, summary } = opts
  const backupFile = basename(zipPath)

  // 1) 破坏性操作前自动快照（失败仅警告，不阻断：回滚能力降级但恢复仍可继续）
  const snapshotDir = createSnapshot(mode, backupFile, summary)

  // 2) 图片写回（可重建；单文件失败仅警告；zip 整体损坏则抛出且尚未触碰数据库）
  let assets: { covers: number; coversFailed: number; keyframes: number; keyframesFailed: number }
  try {
    assets = await writeBackupAssets(zipPath)
  } catch (err) {
    const error = `备份图片解压失败（数据库未改动）：${err instanceof Error ? err.message : String(err)}`
    insertRestoreLog({
      kind: 'restore',
      mode,
      backupFile,
      snapshotDir,
      summary,
      result: 'failed',
      error,
      elapsedMs: Date.now() - started
    })
    return { ok: false, error, logId: undefined, snapshotDir }
  }

  // 3) DB 事务（全有或全无）
  let applied: { inserted: number; updated: number; removed: number; skipped: number; detail: Array<{ sha256: string; action: string }> }
  try {
    applied = applyEntriesTx(mode, manifest.entries, kindBySha)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    // DB 已整体回滚；清理由本次写入产生的孤儿图片（若有），保持目录整洁
    try {
      sweepOrphanAssets()
    } catch {
      /* ignore */
    }
    insertRestoreLog({
      kind: 'restore',
      mode,
      backupFile,
      snapshotDir,
      summary,
      result: 'failed',
      error,
      elapsedMs: Date.now() - started
    })
    return { ok: false, error, logId: undefined, snapshotDir }
  }

  // 4) 封面路径回填：为图片已存在但记录尚无 thumbnail_path 的行补上（占位/覆盖/一致记录全覆盖）
  try {
    backfillThumbnailPaths(manifest.entries)
  } catch {
    /* 回填失败仅影响封面展示，可重扫重建 */
  }

  // 5) 引用计数垃圾回收：清理不再被任何记录/现存快照引用的孤儿封面/关键帧
  let gcRemoved = 0
  try {
    gcRemoved = sweepOrphanAssets()
  } catch {
    /* ignore */
  }

  const stats: RestoreStats = {
    inserted: applied.inserted,
    updated: applied.updated,
    removed: applied.removed,
    skipped: applied.skipped,
    coversWritten: assets.covers,
    coversFailed: assets.coversFailed,
    keyframesWritten: assets.keyframes,
    keyframesFailed: assets.keyframesFailed,
    gcRemoved,
    elapsedMs: Date.now() - started
  }
  const logId = insertRestoreLog({
    kind: 'restore',
    mode,
    backupFile,
    snapshotDir,
    summary,
    stats,
    detail: applied.detail,
    result: 'ok',
    elapsedMs: Date.now() - started
  })
  return { ok: true, logId, snapshotDir, stats }
}
