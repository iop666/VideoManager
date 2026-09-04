import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { getDb, getSetting } from '../db'
import type { KeyframeShot } from '../../shared/types'

// ============ 导出数据结构（0.2.0 新版，见用户推荐结构） ============

export interface VideoMetaExport {
  sha256: string
  title: string
  /** 历史文件名记录（同一 SHA-256 身份导入时见过的全部文件名，自动记录、用户不可修改） */
  MorefileNames: string[]
  category: { name: string; color: string | null } | null
  tags: Array<{ name: string; color: string | null }>
  author: { name: string; color: string | null } | null
  rating: number | null
  remark: string | null
  isFavorite: boolean
  /** 图片相对路径（ZIP 内 images/ 下 <sha256>.jpg） */
  image: string | null
  /** 关键帧截图（名称 + 时间点 + 帧号），ZIP 内 keyframe/ 下同名文件 */
  keyframes: KeyframeShot[]
  videoInfo: {
    sizeBytes: number
    durationSeconds: number | null
    /** 帧率 */
    fps: number | null
    /** 视频总帧数（时长 × 帧率取整） */
    frameCount: number | null
    resolution: { width: number | null; height: number | null }
    codec: string | null
    format: string | null
    playCount: number
  }
  timestamps: {
    firstAdded: string | null
    lastModified: string | null
  }
}

export interface VideoLibraryExport {
  meta: {
    format: string
    version: number
    exported_at: string
  }
  videos: VideoMetaExport[]
}

/** 导出全部已建立 SHA-256 身份的视频元数据（含分类/标签/作者颜色与图片引用） */
export function exportVideosMeta(): VideoMetaExport[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT v.sha256, v.title, v.file_name, v.more_file_names, v.category_id, c.name AS category, c.color AS category_color,
              v.author_id, a.name AS author, a.color AS author_color, v.rating, v.remark, v.is_favorite,
              v.file_size, v.duration, v.fps, v.frame_count, v.keyframes, v.width, v.height, v.codec, v.format, v.play_count,
              v.date_added, v.meta_updated_at, v.thumbnail_path
       FROM videos v
       LEFT JOIN categories c ON c.id = v.category_id
       LEFT JOIN authors a ON a.id = v.author_id
       WHERE v.sha256 IS NOT NULL AND v.sha256 != ''
       ORDER BY v.id`
    )
    .all() as unknown as Array<Record<string, unknown>>

  return rows.map((r) => {
    // 解析历史文件名 JSON；空时以 file_name 兜底（老库兼容）
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
      sha256: r.sha256 as string,
      title: r.title as string,
      MorefileNames: moreFileNames,
      category: r.category
        ? { name: r.category as string, color: (r.category_color as string | null) ?? null }
        : null,
      tags: [] as Array<{ name: string; color: string | null }>,
      author: r.author
        ? { name: r.author as string, color: (r.author_color as string | null) ?? null }
        : null,
      rating: (r.rating as number | null) ?? null,
      remark: (r.remark as string | null) ?? null,
      isFavorite: (r.is_favorite as number) === 1,
      image: r.sha256 ? `images/${r.sha256}.jpg` : null,
      keyframes,
      videoInfo: {
        sizeBytes: (r.file_size as number) ?? 0,
        durationSeconds: (r.duration as number | null) ?? null,
        fps: (r.fps as number | null) ?? null,
        frameCount: (r.frame_count as number | null) ?? null,
        resolution: {
          width: (r.width as number | null) ?? null,
          height: (r.height as number | null) ?? null
        },
        codec: (r.codec as string | null) ?? null,
        format: (r.format as string | null) ?? null,
        playCount: (r.play_count as number) ?? 0
      },
      timestamps: {
        firstAdded: (r.date_added as string | null) ?? null,
        lastModified: (r.meta_updated_at as string | null) ?? null
      }
    }
  })
}

/** 为导出数据补充标签（含颜色，单独查询聚合） */
export function attachTagsToExport(items: VideoMetaExport[]): void {
  if (items.length === 0) return
  const db = getDb()
  const bySha = new Map(items.map((i) => [i.sha256, i]))
  const placeholders = items.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT v.sha256, t.name, t.color FROM video_tags vt
       JOIN videos v ON v.id = vt.video_id
       JOIN tags t ON t.id = vt.tag_id
       WHERE v.sha256 IN (${placeholders}) ORDER BY t.name`
    )
    .all(...items.map((i) => i.sha256)) as unknown as Array<{ sha256: string; name: string; color: string | null }>
  for (const r of rows) {
    bySha.get(r.sha256)?.tags.push({ name: r.name, color: r.color })
  }
}

/** 组装完整导出对象（exported_at 使用北京时间 +08:00，与文件名时间戳一致） */
export function buildLibraryExport(): VideoLibraryExport {
  const videos = exportVideosMeta()
  attachTagsToExport(videos)
  return {
    meta: {
      format: 'video-library-export',
      version: 1,
      exported_at: beijingIso()
    },
    videos
  }
}

/** 北京时间 ISO 字符串（固定东八区 +08:00，毫秒精度；与机器时区无关） */
export function beijingIso(d = new Date()): string {
  // 北京墙钟时间 = UTC + 8 小时
  const bj = new Date(d.getTime() + 8 * 3600000)
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    `${bj.getUTCFullYear()}-${p(bj.getUTCMonth() + 1)}-${p(bj.getUTCDate())}` +
    `T${p(bj.getUTCHours())}:${p(bj.getUTCMinutes())}:${p(bj.getUTCSeconds())}.` +
    `${String(bj.getUTCMilliseconds()).padStart(3, '0')}+08:00`
  )
}

/**
 * 导入元数据：按 SHA-256 匹配视频，更新标题/分类/作者/评分/备注/收藏/标签/颜色。
 * 兼容新旧格式：
 *  - 新版：对象数组（含 category/tags/author 对象带 color）
 *  - 旧版：扁平字符串数组（category/tags/author 为 string）
 * 缺失分类/作者自动创建；未匹配的条目跳过。
 */
export function importVideosMeta(
  items: unknown[],
  opts?: { overwrite?: boolean | null }
): { updated: number; skipped: number; matched: number } {
  const db = getDb()
  // overwrite: true=覆盖已匹配; false=忽略已匹配; null=预检(只统计不写库)
  const overwrite = opts?.overwrite === true
  const preview = opts?.overwrite === null || opts?.overwrite === undefined
  let updated = 0
  let skipped = 0
  let matched = 0
  for (const entry of items) {
    if (!entry || typeof entry !== 'object') {
      skipped++
      continue
    }
    const item = entry as Partial<VideoMetaExport> & {
      // 兼容旧格式：fileName 单值字符串 → 转为 MorefileNames 首项
      fileName?: string
      MorefileNames?: string[]
      category?: string | { name: string; color?: string | null } | null
      tags?: Array<string | { name: string; color?: string | null }>
      author?: string | { name: string; color?: string | null } | null
    }
    if (!item.sha256) {
      skipped++
      continue
    }
    // 历史文件名：新版 MorefileNames 数组；旧版 fileName 字符串加入第一个（旧备份默认 fileName:'' 时为空列表）
    let moreNames: string[] = []
    if (Array.isArray(item.MorefileNames)) {
      moreNames = item.MorefileNames.filter((n): n is string => typeof n === 'string' && n.trim() !== '')
    } else if (typeof item.fileName === 'string' && item.fileName.trim() !== '') {
      moreNames = [item.fileName]
    }
    const firstFileName = moreNames[0] ?? ''
    let row = db.prepare('SELECT id FROM videos WHERE sha256 = ? LIMIT 1').get(item.sha256) as
      | { id: number }
      | undefined
    if (row) {
      // 已存在匹配记录
      matched++
      if (!overwrite) {
        // 用户选择"跳过"：不导入该条
        skipped++
        continue
      }
      // 用户选择"替换本地"：先删除本地记录（含标签关联），再走插入路径重新导入
      db.prepare('DELETE FROM video_tags WHERE video_id = ?').run(row.id)
      db.prepare('DELETE FROM videos WHERE id = ?').run(row.id)
      row = undefined
    }
    if (!row) {
      // 预检模式下不插入占位（避免副作用）
      if (preview) {
        skipped++
        continue
      }
      // 库中无此 sha256（或已按"替换"删除）：插入占位记录
      // 占位记录用唯一虚拟路径 `restored://<sha256>`（file_path 有 UNIQUE 约束，不能都用 '' 否则只插入 1 条）；
      // status='ready'（非 missing，元数据可正常显示），扫描时按 sha256 关联真实文件路径
      const placeholderPath = `restored://${item.sha256}`
      const placeholder = db
        .prepare('SELECT id FROM videos WHERE file_path = ? LIMIT 1')
        .get(placeholderPath) as { id: number } | undefined
      if (placeholder) {
        row = placeholder
      } else {
        try {
          const ins = db
            .prepare(
              `INSERT OR IGNORE INTO videos (title, file_path, file_name, more_file_names, file_size, duration, fps, frame_count,
                                             keyframes, width, height,
                                             codec, format, sha256, hash_computed, date_added, status, is_favorite, play_count)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, COALESCE(?, datetime('now','localtime')), 'ready', ?, ?)`
            )
            .run(
              item.title || '(未命名)',
              placeholderPath,
              firstFileName,
              JSON.stringify(moreNames),
              item.videoInfo?.sizeBytes ?? 0,
              item.videoInfo?.durationSeconds ?? null,
              item.videoInfo?.fps ?? null,
              item.videoInfo?.frameCount ?? null,
              JSON.stringify(item.keyframes ?? []),
              item.videoInfo?.resolution?.width ?? null,
              item.videoInfo?.resolution?.height ?? null,
              item.videoInfo?.codec ?? null,
              item.videoInfo?.format ?? null,
              item.sha256,
              item.timestamps?.firstAdded ?? null,
              item.isFavorite ? 1 : 0,
              item.videoInfo?.playCount ?? 0
            )
          if (Number(ins.lastInsertRowid) > 0) row = { id: Number(ins.lastInsertRowid) }
        } catch {
          // 极端冲突：回退查询该占位路径
          const anyPlaceholder = db
            .prepare('SELECT id FROM videos WHERE file_path = ? ORDER BY id LIMIT 1')
            .get(placeholderPath) as { id: number } | undefined
          row = anyPlaceholder ?? undefined
        }
      }
    }
    // 无法确定目标记录（极罕见）：跳过
    if (!row) {
      skipped++
      continue
    }
    const cat = item.category
    const catName = typeof cat === 'string' ? cat : (cat?.name ?? null)
    const catColor = typeof cat === 'object' && cat ? (cat.color ?? null) : null
    const aut = item.author
    const autName = typeof aut === 'string' ? aut : (aut?.name ?? null)
    const autColor = typeof aut === 'object' && aut ? (aut.color ?? null) : null

    let categoryId: number | null = null
    if (catName && catName.trim()) {
      db.prepare('INSERT OR IGNORE INTO categories (name, color) VALUES (?, ?)').run(catName.trim(), catColor)
      categoryId = (
        db.prepare('SELECT id FROM categories WHERE name = ?').get(catName.trim()) as { id: number }
      ).id
      // 分类已存在时也更新颜色
      db.prepare('UPDATE categories SET color = COALESCE(?, color) WHERE id = ?').run(catColor, categoryId)
    }
    let authorId: number | null = null
    if (autName && autName.trim()) {
      db.prepare('INSERT OR IGNORE INTO authors (name, color) VALUES (?, ?)').run(autName.trim(), autColor)
      authorId = (
        db.prepare('SELECT id FROM authors WHERE name = ?').get(autName.trim()) as { id: number }
      ).id
      db.prepare('UPDATE authors SET color = COALESCE(?, color) WHERE id = ?').run(autColor, authorId)
    }
    const tagNames = (item.tags ?? []).map((t) =>
      typeof t === 'string' ? t : (t?.name ?? '')
    )
    const tagColors = (item.tags ?? []).map((t) =>
      typeof t === 'object' && t ? (t.color ?? null) : null
    )
    // 设置标签（含颜色）
    setVideoTagsWithColors(row.id, tagNames, tagColors)

    db.prepare(
      `UPDATE videos SET title = ?, category_id = ?, author_id = ?, rating = ?, remark = ?, is_favorite = ?,
       fps = COALESCE(?, fps), frame_count = COALESCE(?, frame_count),
       keyframes = CASE WHEN ? != '' THEN ? ELSE keyframes END
       WHERE id = ?`
    ).run(
      item.title || '(未命名)',
      categoryId,
      authorId,
      item.rating ?? null,
      item.remark ?? null,
      item.isFavorite ? 1 : 0,
      item.videoInfo?.fps ?? null,
      item.videoInfo?.frameCount ?? null,
      JSON.stringify(item.keyframes ?? []),
      JSON.stringify(item.keyframes ?? []),
      row.id
    )
    // 关联封面：若缩略图目录存在 <sha256>.jpg 且记录无缩略图，则设置 thumbnail_path
    try {
      const thumbDir = getSetting('thumbnail_dir') ?? join(app.getPath('userData'), 'thumbnails')
      const coverPath = join(thumbDir, `${item.sha256}.jpg`)
      if (existsSync(coverPath)) {
        db.prepare('UPDATE videos SET thumbnail_path = ? WHERE id = ? AND (thumbnail_path IS NULL OR thumbnail_path = ?)')
          .run(coverPath, row.id, '')
      }
    } catch {
      /* 封面关联失败不影响 */
    }
    updated++
  }
  return { updated, skipped, matched }
}

/** 设置视频标签并同步颜色（缺失标签自动创建并带上颜色） */
function setVideoTagsWithColors(videoId: number, tagNames: string[], tagColors: (string | null)[]): void {
  const db = getDb()
  const names = [...new Set(tagNames.map((t) => t.trim()).filter(Boolean))].slice(0, 10)
  db.prepare('DELETE FROM video_tags WHERE video_id = ?').run(videoId)
  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)')
  const getTag = db.prepare('SELECT id FROM tags WHERE name = ?')
  const link = db.prepare('INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES (?, ?)')
  for (let i = 0; i < names.length; i++) {
    const name = names[i]
    const color = tagColors[i] ?? null
    insertTag.run(name, color)
    const tag = getTag.get(name) as { id: number }
    // 已有标签也更新颜色
    db.prepare('UPDATE tags SET color = COALESCE(?, color) WHERE id = ?').run(color, tag.id)
    link.run(videoId, tag.id)
  }
  db.prepare("UPDATE videos SET meta_updated_at = datetime('now','localtime') WHERE id = ?").run(videoId)
}
