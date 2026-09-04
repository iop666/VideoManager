import { zipSync, unzipSync, strToU8, type Zippable } from 'fflate'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { getDb, getSetting } from '../db'
import { buildLibraryExport, importVideosMeta, type VideoLibraryExport } from './metaIO'
import { keyframeDir } from './keyframes'

// ============ ZIP 导出：JSON + 封面图片 + 关键帧截图 ============
// export.zip
// ├── data.json          # 元数据 + 图片引用
// ├── images/
// │   ├── <sha256>.jpg
// │   └── ...
// └── keyframe/          # 关键帧截图（Keyframe_<sha256>_NN.jpg）
//     └── ...

/** 缩略图目录（与 scanner 一致：settings 或 userData/thumbnails） */
function thumbDir(): string {
  return getSetting('thumbnail_dir') ?? join(app.getPath('userData'), 'thumbnails')
}

/**
 * 构建导出 ZIP 缓冲：
 *  - data.json：新版结构（meta + videos，image 指向 images/<sha256>.jpg）
 *  - images/<sha256>.jpg：从缩略图目录复制（文件名即 sha256）
 */
export function buildExportZip(): { zip: Uint8Array; count: number; missingCovers: number } {
  const data = buildLibraryExport()
  const zip: Zippable = {}
  zip['data.json'] = strToU8(JSON.stringify(data, null, 2))

  const db = getDb()
  const tdir = thumbDir()
  const kdir = keyframeDir()
  let missingCovers = 0
  let keyframesCopied = 0

  for (const v of data.videos) {
    if (!v.sha256) continue
    // 优先：缩略图文件名即 sha256.jpg（新扫描命名）
    const bySha = join(tdir, `${v.sha256}.jpg`)
    let imgPath = existsSync(bySha) ? bySha : null
    if (!imgPath) {
      // 兼容旧命名：查 thumbnail_path 数据库字段
      const row = db.prepare('SELECT thumbnail_path FROM videos WHERE sha256 = ? LIMIT 1').get(v.sha256) as
        | { thumbnail_path: string | null }
        | undefined
      if (row?.thumbnail_path && existsSync(row.thumbnail_path)) imgPath = row.thumbnail_path
    }
    if (imgPath) {
      try {
        zip[`images/${v.sha256}.jpg`] = new Uint8Array(readFileSync(imgPath))
      } catch {
        missingCovers++
      }
    } else {
      missingCovers++
    }

    // 关键帧截图：Keyframe_<sha256>_NN.jpg（data.json 的 keyframes 已含名称列表）
    if (v.keyframes?.length) {
      for (const kf of v.keyframes) {
        const kfPath = join(kdir, kf.name)
        try {
          if (existsSync(kfPath)) {
            zip[`keyframe/${kf.name}`] = new Uint8Array(readFileSync(kfPath))
            keyframesCopied++
          }
        } catch {
          /* 单张关键帧缺失不影响整体导出 */
        }
      }
    }
  }

  console.log(`[videomanager] 导出：${data.videos.length} 条视频 · 封面缺失 ${missingCovers} · 关键帧 ${keyframesCopied} 张`)
  return { zip: zipSync(zip, { level: 6 }), count: data.videos.length, missingCovers }
}

/**
 * 解析导入 ZIP：读取 data.json（兼容新版/旧版）并提取封面到缩略图目录、关键帧到关键帧目录。
 * 只解析不写元数据，返回 items 供后续应用（避免重复读文件/二次选文件）。
 */
export function parseExportZip(zipBuf: Uint8Array): { items: unknown[]; covers: number; keyframes: number } {
  const files = unzipSync(zipBuf)
  const db = getDb()

  // 1) 解析 data.json（兼容新版对象 + 旧版数组）
  const dataEntry = files['data.json']
  if (!dataEntry) throw new Error('ZIP 中缺少 data.json')
  const parsed = JSON.parse(new TextDecoder().decode(dataEntry)) as
    | VideoLibraryExport
    | unknown[]
  const items: unknown[] = Array.isArray(parsed)
    ? parsed
    : ((parsed as VideoLibraryExport).videos ?? [])

  // 2) 提取封面图片 → 缩略图目录
  const tdir = thumbDir()
  mkdirSync(tdir, { recursive: true })
  let covers = 0
  for (const [path, buf] of Object.entries(files)) {
    const m = /^images\/([0-9a-f]{64})\.(jpg|jpeg|png|webp)$/i.exec(path)
    if (!m) continue
    const sha = m[1].toLowerCase()
    const dest = join(tdir, `${sha}.jpg`)
    try {
      writeFileSync(dest, buf)
      // 更新 thumbnail_path（若该视频已存在）
      db.prepare('UPDATE videos SET thumbnail_path = ? WHERE sha256 = ?').run(dest, sha)
      covers++
    } catch {
      /* 封面写入失败不影响元数据 */
    }
  }

  // 3) 提取关键帧截图 → 关键帧目录（Keyframe_<sha256>_NN.jpg，data.json 的 keyframes 字段带记录）
  const kdir = keyframeDir()
  mkdirSync(kdir, { recursive: true })
  let keyframes = 0
  for (const [path, buf] of Object.entries(files)) {
    const m = /^keyframe\/(Keyframe_[0-9a-f]{64}_\d+\.jpg)$/i.exec(path)
    if (!m) continue
    const name = m[1]
    const dest = join(kdir, name)
    try {
      writeFileSync(dest, buf)
      keyframes++
    } catch {
      /* 单张关键帧写入失败不影响整体 */
    }
  }

  return { items, covers, keyframes }
}

/**
 * 应用解析出的 items 到数据库。
 * overwrite: true=替换(删本地再导); false=跳过已存在; null=预检(只统计)
 */
export function importExportZip(
  items: unknown[],
  opts?: { overwrite?: boolean | null }
): { updated: number; skipped: number; matched: number; covers: number } {
  const result = importVideosMeta(items, { overwrite: opts?.overwrite })
  return { updated: result.updated, skipped: result.skipped, matched: result.matched, covers: 0 }
}
