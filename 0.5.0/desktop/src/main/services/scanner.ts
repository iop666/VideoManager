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
 * - 文件大小 + mtime 未变化（且记录正常） → 跳过
 * - 记录缺失(missing)但文件又出现在原路径（内容相同） → 快速恢复 ready（保留标题等元数据）
 * - 新文件 → ffprobe 提元数据 + 生成缩略图 + 插入
 * - 已入库但内容变化 → 更新（标题保留用户修改值）
 * - 同哈希记录在其它路径（含 missing/占位） → 位置迁移（保留元数据与标题）
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

  const selectById = db.prepare(
    'SELECT id, file_size, date_modified, thumbnail_path, sha256, status, title, file_name, more_file_names, duration FROM videos WHERE file_path = ?'
  )
  /** 追加历史文件名（JSON 数组去重） */
  function appendFileName(id: number, name: string): void {
    const row = db.prepare('SELECT more_file_names FROM videos WHERE id = ?').get(id) as
      | { more_file_names: string | null }
      | undefined
    let list: string[] = []
    try {
      const parsed = JSON.parse(row?.more_file_names ?? '[]') as unknown
      if (Array.isArray(parsed)) list = parsed.filter((x): x is string => typeof x === 'string')
    } catch {
      list = []
    }
    if (!list.includes(name)) {
      list.push(name)
      db.prepare('UPDATE videos SET more_file_names = ? WHERE id = ?').run(JSON.stringify(list), id)
    }
  }
  const updateThumb = db.prepare('UPDATE videos SET thumbnail_path = ? WHERE id = ?')

  /** 文件主干名（默认标题：去掉扩展名的文件名） */
  const stemOf = (name: string): string => basename(name, extname(name))

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
    const baseName = basename(file)
    const newStem = stemOf(baseName)
    const existing = selectById.get(file) as
      | {
          id: number
          file_size: number
          date_modified: string | null
          thumbnail_path: string | null
          sha256: string | null
          status: string
          title: string
          file_name: string
          more_file_names: string | null
          duration: number | null
        }
      | undefined

    const statsSame = existing?.file_size === st.size && existing?.date_modified === mtimeIso

    // 记录正常且内容未变 → 跳过
    if (
      existing &&
      existing.status !== 'missing' &&
      statsSame &&
      existing.sha256
    ) {
      skipped++
      continue
    }

    // 记录缺失(missing)但同一文件原样回到原路径（大小/mtime/哈希均未变）→ 快速恢复，不重算哈希
    if (
      existing &&
      existing.status === 'missing' &&
      statsSame &&
      existing.sha256
    ) {
      db.prepare("UPDATE videos SET status = 'ready' WHERE id = ?").run(existing.id)
      if (!existing.thumbnail_path) {
        const thumbPath = join(thumbDir, `${existing.sha256}.jpg`)
        const ok = await generateThumbnail(ffmpeg, file, thumbPath, existing.duration)
        if (ok) updateThumb.run(thumbPath, existing.id)
      }
      updated++
      continue
    }

    try {
      const info = await probeMedia(ffprobe, file)
      // 容器格式按扩展名展示（ffprobe 的 mov,mp4,... 首个元素不可读）
      const extFormat = extname(file).slice(1).toLowerCase()
      // SHA-256 唯一身份（流式计算；仅在导入/文件变更时执行）
      const sha256 = await computeSha256(file)

      // 情形 A：同路径已有记录（缺失恢复 / 内容更新）→ 就地更新，保留标题与其它元数据
      if (existing) {
        db.prepare(
          `UPDATE videos SET file_name = ?, file_size = ?, duration = ?, width = ?, height = ?,
           codec = ?, audio_codec = ?, format = ?, sha256 = ?, hash_computed = 1, date_modified = ?,
           fps = COALESCE(?, fps), status = 'ready'
           WHERE id = ?`
        ).run(
          baseName, st.size, info.duration, info.width, info.height,
          info.videoCodec, info.audioCodec, extFormat, sha256, mtimeIso,
          info.fps, existing.id
        )
        appendFileName(existing.id, baseName)
        const videoId = existing.id
        if (!existing.thumbnail_path) {
          // 封面文件命名：<视频sha256>.jpg（需求：封面文件名对应 sha256）
          const thumbPath = join(thumbDir, `${sha256}.jpg`)
          const ok = await generateThumbnail(ffmpeg, file, thumbPath, info.duration)
          if (ok) updateThumb.run(thumbPath, videoId)
        }
        updated++
        continue
      }

      // 情形 B：同一哈希的记录在其它路径（含缺失 / restored:// 占位）→ 位置迁移，保留元数据
      const hashMatch = db
        .prepare(
          `SELECT id, title, file_name, thumbnail_path, more_file_names FROM videos
           WHERE sha256 = ? ORDER BY id LIMIT 1`
        )
        .get(sha256) as
        | {
            id: number
            title: string
            file_name: string
            thumbnail_path: string | null
            more_file_names: string | null
          }
        | undefined

      if (hashMatch) {
        // 标题策略：仅当原标题还是旧文件的默认标题（stem）时跟随新文件名；
        // 若用户手动改过标题（不等于旧 stem）→ 保留用户修改
        const oldStem = stemOf(hashMatch.file_name)
        const nextTitle = hashMatch.title === oldStem ? newStem : hashMatch.title
        db.prepare(
          `UPDATE videos SET file_path = ?, file_name = ?, file_size = ?, duration = ?, width = ?, height = ?,
           codec = ?, audio_codec = ?, format = ?, sha256 = ?, hash_computed = 1, date_modified = ?,
           fps = COALESCE(?, fps), status = 'ready', title = ?
           WHERE id = ?`
        ).run(
          file, baseName, st.size, info.duration, info.width, info.height,
          info.videoCodec, info.audioCodec, extFormat, sha256, mtimeIso,
          info.fps, nextTitle, hashMatch.id
        )
        // 历史文件名记录：新出现的文件名追加（同一哈希身份可能对应多个文件名）
        appendFileName(hashMatch.id, baseName)
        // 缩略图保留（位置迁移不重新截帧；仅当迁移目标无缩略图时生成）
        if (!hashMatch.thumbnail_path) {
          const thumbPath = join(thumbDir, `${sha256}.jpg`)
          const ok = await generateThumbnail(ffmpeg, file, thumbPath, info.duration)
          if (ok) updateThumb.run(thumbPath, hashMatch.id)
        }
        moved++
        continue
      }

      // 情形 C：全新视频 → 插入，标题默认取文件名 stem，首个历史文件名记录
      const ins = db
        .prepare(
          `INSERT INTO videos (title, file_path, file_name, more_file_names, file_size, duration, width, height,
                              codec, audio_codec, format, fps, sha256, hash_computed, date_modified, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'ready')`
        )
        .run(
          newStem, file, baseName, JSON.stringify([baseName]), st.size, info.duration,
          info.width, info.height, info.videoCodec, info.audioCodec, extFormat,
          info.fps, sha256, mtimeIso
        )
      const videoId = Number(ins.lastInsertRowid)
      // 封面文件命名：<视频sha256>.jpg
      const thumbPath = join(thumbDir, `${sha256}.jpg`)
      const ok = await generateThumbnail(ffmpeg, file, thumbPath, info.duration)
      if (ok) updateThumb.run(thumbPath, videoId)
      added++
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
