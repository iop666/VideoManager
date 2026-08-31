import { app } from 'electron'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { getDb, getSetting } from '../db'
import { resolveFfmpegPaths } from './ffmpeg'
import { probeMedia } from './mediaInfo'
import { generateThumbnail } from './thumbnailer'

export const VIDEO_EXTENSIONS = new Set([
  '.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm',
  '.ts', '.m2ts', '.m4v', '.mpg', '.mpeg', '.3gp', '.rmvb', '.rm'
])

export interface ScanProgress {
  phase: 'scan' | 'probe'
  current: number
  total: number
}

export interface ScanResult {
  added: number
  updated: number
  /** SHA-256 匹配 → 位置迁移（保留原记录） */
  moved: number
  missing: number
  failed: number
  skipped: number
  totalFiles: number
  elapsedMs: number
}

export interface ScanOptions {
  recursive: boolean
  onProgress?: (p: ScanProgress) => void
}

/** 流式计算文件 SHA-256（8MB 分块，大文件内存友好） */
export async function computeSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath, { highWaterMark: 8 * 1024 * 1024 })
    stream.on('data', (chunk: Buffer) => hash.update(chunk))
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })
  return hash.digest('hex')
}

/** 递归收集文件夹下所有视频文件 */
async function collectVideoFiles(
  folder: string,
  recursive: boolean
): Promise<string[]> {
  const files: string[] = []
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (recursive) await walk(full)
      } else if (entry.isFile() && VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        files.push(full)
      }
    }
  }
  await walk(folder)
  return files
}

/**
 * 扫描文件夹并增量入库：
 * - 文件大小 + mtime 未变化 → 跳过
 * - 新文件 → ffprobe 提元数据 + 生成缩略图 + 插入
 * - 已入库但内容变化 → 更新
 * - 数据库中存在但磁盘上已消失 → 标记 missing
 */
export async function scanFolder(folder: string, options: ScanOptions): Promise<ScanResult> {
  const startedAt = Date.now()
  const db = getDb()
  const { ffmpeg, ffprobe } = resolveFfmpegPaths(app.getAppPath())
  const thumbDir = getSetting('thumbnail_dir') ?? join(app.getPath('userData'), 'thumbnails')

  options.onProgress?.({ phase: 'scan', current: 0, total: 0 })
  const files = await collectVideoFiles(folder, options.recursive)
  const total = files.length

  let added = 0
  let updated = 0
  let moved = 0
  let missing = 0
  let failed = 0
  let skipped = 0
  const seen = new Set<string>()

  const selectById = db.prepare('SELECT id, file_size, date_modified, thumbnail_path, sha256 FROM videos WHERE file_path = ?')
  const upsert = db.prepare(`
    INSERT INTO videos (title, file_path, file_name, file_size, duration, width, height,
                        codec, audio_codec, format, sha256, hash_computed, date_modified, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'ready')
    ON CONFLICT(file_path) DO UPDATE SET
      file_size = excluded.file_size,
      duration = excluded.duration,
      width = excluded.width,
      height = excluded.height,
      codec = excluded.codec,
      audio_codec = excluded.audio_codec,
      format = excluded.format,
      sha256 = excluded.sha256,
      hash_computed = 1,
      date_modified = excluded.date_modified,
      status = 'ready',
      title = excluded.title
  `)
  const updateThumb = db.prepare('UPDATE videos SET thumbnail_path = ? WHERE id = ?')

  for (let i = 0; i < total; i++) {
    const file = files[i]
    seen.add(file)
    options.onProgress?.({ phase: 'probe', current: i + 1, total })

    let st
    try {
      st = await stat(file)
    } catch {
      failed++
      continue
    }
    const mtimeIso = new Date(st.mtimeMs).toISOString()
    const existing = selectById.get(file) as
      | {
          id: number
          file_size: number
          date_modified: string | null
          thumbnail_path: string | null
          sha256: string | null
        }
      | undefined

    if (
      existing &&
      existing.file_size === st.size &&
      existing.date_modified === mtimeIso &&
      existing.sha256
    ) {
      skipped++
      continue
    }

    try {
      const info = await probeMedia(ffprobe, file)
      const title = basename(file, extname(file))
      // 容器格式按扩展名展示（ffprobe 的 mov,mp4,... 首个元素不可读）
      const extFormat = extname(file).slice(1).toLowerCase()
      // SHA-256 唯一身份（流式计算；仅在导入/文件变更时执行）
      const sha256 = await computeSha256(file)

      // 已有同名哈希的视频记录 → 位置迁移（不重复建条目，保留 id 与元数据）
      const hashMatch = db
        .prepare(
          "SELECT id, title, file_name, thumbnail_path FROM videos WHERE sha256 = ? AND id != ? LIMIT 1"
        )
        .get(sha256, existing?.id ?? 0) as
        | { id: number; title: string; file_name: string; thumbnail_path: string | null }
        | undefined

      if (hashMatch) {
        db.prepare(
          `UPDATE videos SET file_path = ?, file_name = ?, file_size = ?, duration = ?, width = ?, height = ?,
           codec = ?, audio_codec = ?, format = ?, sha256 = ?, hash_computed = 1, date_modified = ?,
           status = 'ready',
           title = CASE WHEN title = ? THEN ? ELSE title END
           WHERE id = ?`
        ).run(
          file, basename(file), st.size, info.duration, info.width, info.height,
          info.videoCodec, info.audioCodec, extFormat, sha256, mtimeIso,
          hashMatch.title, title, hashMatch.id
        )
        // 缩略图保留（位置迁移不重新截帧）
        moved++
        continue
      }

      const res = upsert.run(
        title, file, basename(file), st.size, info.duration, info.width, info.height,
        info.videoCodec, info.audioCodec, extFormat, sha256, mtimeIso
      )
      const videoId =
        existing?.id ?? Number(res.lastInsertRowid)

      if (!existing?.thumbnail_path) {
        // 封面文件命名：<视频sha256>.jpg（需求：封面文件名对应 sha256）
        const thumbPath = join(thumbDir, `${sha256}.jpg`)
        const ok = await generateThumbnail(ffmpeg, file, thumbPath, info.duration)
        if (ok) updateThumb.run(thumbPath, videoId)
      }

      if (existing) updated++
      else added++
    } catch {
      failed++
    }
  }

  // 缺失检测：以文件夹为前缀，不在本次扫描集合中的视频标记为 missing
  const prefix = folder.endsWith('\\') || folder.endsWith('/') ? folder : folder + '\\'
  const escaped = prefix.replace(/[\\_%]/g, (m) => '\\' + m)
  const rows = db
    .prepare(`SELECT id, file_path FROM videos WHERE file_path LIKE ? ESCAPE '\\' AND status != 'missing'`)
    .all(escaped + '%') as { id: number; file_path: string }[]
  const markMissing = db.prepare("UPDATE videos SET status = 'missing' WHERE id = ?")
  for (const row of rows) {
    if (!seen.has(row.file_path)) {
      markMissing.run(row.id)
      missing++
    }
  }

  db.prepare("UPDATE import_folders SET last_scanned_at = datetime('now', 'localtime') WHERE path = ?").run(folder)

  return {
    added, updated, moved, missing, failed, skipped,
    totalFiles: total,
    elapsedMs: Date.now() - startedAt
  }
}
