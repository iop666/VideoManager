import { zipSync, strToU8, type Zippable } from 'fflate'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { getDb, getSetting } from '../db'
import { buildLibraryExport } from './metaIO'
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
