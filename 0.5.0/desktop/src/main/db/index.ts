import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'node:fs'
import schemaSql from './schema.sql?raw'

let db: DatabaseSync | null = null

export interface DbStats {
  videos: number
  categories: number
  tags: number
  tasks: number
  importFolders: number
}

/** 数据库文件路径（userData 目录下） */
export function getDbPath(): string {
  return join(app.getPath('userData'), 'videomanager.db')
}

/** 初始化数据库：打开连接、WAL 模式、执行 schema、老库迁移 */
export function initDatabase(): DatabaseSync {
  if (db) return db
  const dbPath = getDbPath()
  mkdirSync(app.getPath('userData'), { recursive: true })
  db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(schemaSql)
  migrate(db)
  return db
}

/**
 * 老库迁移：
 * 1) videos 增加 sha256 / hash_computed / author_id 列
 * 2) 将历史 videos.author 字符串迁入 authors 表并建立 author_id 关联
 */
function migrate(d: DatabaseSync): void {
  const cols = d.prepare('PRAGMA table_info(videos)').all() as unknown as Array<{ name: string }>
  const has = (name: string): boolean => cols.some((c) => c.name === name)

  if (!has('sha256')) d.exec('ALTER TABLE videos ADD COLUMN sha256 TEXT')
  if (!has('hash_computed')) d.exec('ALTER TABLE videos ADD COLUMN hash_computed INTEGER NOT NULL DEFAULT 0')
  if (!has('author_id')) d.exec('ALTER TABLE videos ADD COLUMN author_id INTEGER REFERENCES authors(id) ON DELETE SET NULL')
  // 元数据最近保存时间（安卓自动同步增量依据）
  if (!has('meta_updated_at')) d.exec("ALTER TABLE videos ADD COLUMN meta_updated_at TEXT")

  // 历史文件名记录（JSON 数组）：老库无此列则新增；新库由 schema.sql 建表
  if (!has('more_file_names')) {
    d.exec("ALTER TABLE videos ADD COLUMN more_file_names TEXT NOT NULL DEFAULT '[]'")
  }
  // 帧率 / 总帧数 / 关键帧截图记录（JSON）：老库无此列则新增
  if (!has('fps')) d.exec('ALTER TABLE videos ADD COLUMN fps REAL')
  if (!has('frame_count')) d.exec('ALTER TABLE videos ADD COLUMN frame_count INTEGER')
  if (!has('keyframes')) d.exec("ALTER TABLE videos ADD COLUMN keyframes TEXT NOT NULL DEFAULT '[]'")
  // 老库回填：把已有 file_name（非空、且不是 restored:// 占位路径的空名）作为第一个历史文件名
  const mfnRows = d
    .prepare(
      "SELECT id, file_name FROM videos WHERE file_name IS NOT NULL AND file_name != '' AND (more_file_names IS NULL OR more_file_names = '[]')"
    )
    .all() as unknown as Array<{ id: number; file_name: string }>
  for (const row of mfnRows) {
    d.prepare('UPDATE videos SET more_file_names = ? WHERE id = ?').run(
      JSON.stringify([row.file_name]),
      row.id
    )
  }

  // 新列索引（必须在 ALTER 之后创建）
  d.exec('CREATE INDEX IF NOT EXISTS idx_videos_sha256 ON videos(sha256)')
  d.exec('CREATE INDEX IF NOT EXISTS idx_videos_author ON videos(author_id)')

  // 分类/标签/作者 color 列（老库迁移）
  const catCols = d.prepare('PRAGMA table_info(categories)').all() as unknown as Array<{ name: string }>
  if (!catCols.some((c) => c.name === 'color')) d.exec('ALTER TABLE categories ADD COLUMN color TEXT')
  const tagCols = d.prepare('PRAGMA table_info(tags)').all() as unknown as Array<{ name: string }>
  if (!tagCols.some((c) => c.name === 'color')) d.exec('ALTER TABLE tags ADD COLUMN color TEXT')
  const authorCols = d.prepare('PRAGMA table_info(authors)').all() as unknown as Array<{ name: string }>
  if (!authorCols.some((c) => c.name === 'color')) d.exec('ALTER TABLE authors ADD COLUMN color TEXT')

  // 作者迁移：videos.author → authors 表（仅当 author_id 全为空时执行一次）
  const authorIdSet = d.prepare("SELECT COUNT(*) AS c FROM videos WHERE author_id IS NOT NULL").get() as { c: number }
  if (authorIdSet.c === 0) {
    const rows = d
      .prepare("SELECT DISTINCT author FROM videos WHERE author IS NOT NULL AND TRIM(author) != ''")
      .all() as unknown as Array<{ author: string }>
    const insertAuthor = d.prepare('INSERT OR IGNORE INTO authors (name) VALUES (?)')
    const getAuthor = d.prepare('SELECT id FROM authors WHERE name = ?')
    const updateVideo = d.prepare('UPDATE videos SET author_id = ? WHERE author = ? AND author_id IS NULL')
    for (const row of rows) {
      insertAuthor.run(row.author)
      const a = getAuthor.get(row.author) as { id: number }
      updateVideo.run(a.id, row.author)
    }
    if (rows.length > 0) {
      console.log(`[videomanager] 已迁移 ${rows.length} 个作者到 authors 表`)
    }
  }
}

/** 获取已初始化的数据库连接（未初始化时抛错） */
export function getDb(): DatabaseSync {
  if (!db) throw new Error('数据库尚未初始化')
  return db
}

/** 各核心表行数统计（用于 UI 展示与健康检查） */
export function getDbStats(): DbStats {
  const d = getDb()
  const count = (table: string): number => {
    const row = d.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }
    return row.c
  }
  return {
    videos: count('videos'),
    categories: count('categories'),
    tags: count('tags'),
    tasks: count('tasks'),
    importFolders: count('import_folders')
  }
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}

/** 读取设置项（无默认值返回 null） */
export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

/** 写入设置项 */
export function setSetting(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}
