import { execFile } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import { getDb, getSetting } from '../db'
import { resolveFfmpegPaths } from './ffmpeg'
import { probeMedia } from './mediaInfo'
import type { KeyframeShot } from '../../shared/types'

const execFileAsync = promisify(execFile)

export type { KeyframeShot }

/** 文件夹关键帧补齐结果 */
export interface KeyframeBacklogResult {
  /** 处理了多少个视频 */
  videos: number
  /** 成功生成多少张关键帧截图 */
  frames: number
  /** 跳过的视频数（无本地文件 / probe 失败 / 时长不足） */
  skipped: number
}

/**
 * 为文件夹范围内本地可读视频补齐/重建关键帧截图：
 * - 无关键帧记录 → 生成
 * - 有关键帧但为旧规格（无 v 版本字段，原分辨率 q2 大图）→ 删除旧图并重建（960px 规格）
 * - 已是当前规格（v=2）且文件存在 → 跳过
 * 逐个串行执行；文件已不存在/非本地自动跳过。
 * 返回实际统计，便于任务消息展示"共生成多少关键帧"。
 */
export async function generateKeyframesForFolder(
  folderPrefix: string,
  onProgress?: (current: number, total: number) => void
): Promise<KeyframeBacklogResult> {
  const result: KeyframeBacklogResult = { videos: 0, frames: 0, skipped: 0 }
  try {
    const db = getDb()
    const escaped = folderPrefix.replace(/[\\_%]/g, (m) => '\\' + m)
    const rows = db
      .prepare(
        `SELECT v.file_path, v.sha256, v.duration, v.fps, v.keyframes
         FROM videos v
         WHERE v.file_path LIKE ? ESCAPE '\\'
           AND v.status = 'ready'
           AND v.file_path NOT LIKE 'restored://%'
           AND v.sha256 IS NOT NULL AND v.sha256 != ''`
      )
      .all(escaped + '%') as unknown as Array<{
      file_path: string
      sha256: string
      duration: number | null
      fps: number | null
      keyframes: string | null
    }>
    if (rows.length === 0) return result

    const { ffmpeg, ffprobe } = resolveFfmpegPaths(app.getAppPath())
    // 仅处理需要生成/重建的视频
    const need = rows.filter((row) => {
      if (!existsSync(row.file_path)) return false
      const shots = parseKeyframes(row.keyframes)
      if (shots.length === 0) return true
      // 旧规格（无 v=2）需重建
      if (!shots.every((s) => s.v === 2)) return true
      // 文件缺失需重建
      return !existsSync(join(keyframeDir(), shots[0].name))
    })
    const total = need.length
    let idx = 0
    for (const row of need) {
      idx++
      onProgress?.(idx, total)
      try {
        let duration = row.duration
        let fps = row.fps
        if (duration === null || duration === undefined || fps === null || fps === undefined) {
          try {
            const info = await probeMedia(ffprobe, row.file_path)
            duration = info.duration
            fps = info.fps
          } catch {
            /* probe 失败则跳过该视频 */
            result.skipped++
            continue
          }
        }
        // 重建前清理旧关键帧文件（同名会覆盖，但旧规格张数可能不同，多余文件需删除）
        removeExistingKeyframes(row.sha256)
        const res = await generateKeyframesForVideo(ffmpeg, row.file_path, row.sha256, duration, fps)
        result.videos++
        result.frames += res.generated
        if (res.generated === 0) result.skipped++
      } catch {
        result.skipped++
      }
    }
    if (result.frames > 0) {
      console.log(`[videomanager] 关键帧截图补齐完成：共 ${result.frames} 张（${result.videos} 个视频）`)
    }
  } catch {
    /* ignore */
  }
  return result
}

/** 删除某 sha256 的全部关键帧文件（Keyframe_<sha256>_*.jpg） */
function removeExistingKeyframes(sha256: string): void {
  try {
    const { readdirSync, rmSync } = require('node:fs') as typeof import('node:fs')
    const dir = keyframeDir()
    if (!existsSync(dir)) return
    const prefix = `Keyframe_${sha256}_`
    for (const f of readdirSync(dir)) {
      if (f.startsWith(prefix) && f.endsWith('.jpg')) {
        try {
          rmSync(join(dir, f), { force: true })
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
}

/** 关键帧目录（settings keyframe_dir 或 userData/keyframes） */
/** 关键帧目录（settings keyframe_dir 或 userData/keyframe，导出 zip 内同名 keyframe/ 文件夹） */
export function keyframeDir(): string {
  return getSetting('keyframe_dir') ?? join(app.getPath('userData'), 'keyframe')
}

/** 解析 DB 存储的关键帧 JSON */
export function parseKeyframes(raw: string | null): KeyframeShot[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (x): x is KeyframeShot =>
        !!x &&
        typeof x === 'object' &&
        typeof (x as KeyframeShot).name === 'string' &&
        typeof (x as KeyframeShot).timeSec === 'number'
    )
  } catch {
    return []
  }
}

/**
 * 依据时长决定截取帧数（规则随版本调整）：
 * - ≥300 秒 → 12 帧
 * - ≥180 秒 → 9 帧（不足 300 秒）
 * - ≥60 秒  → 6 帧（不足 180 秒）
 * - ≥1 秒   → 3 帧（不足 60 秒）
 * - <1 秒   → 跳过（返回 0）
 */
export function keyframeCountFor(durationSec: number | null): number {
  if (durationSec === null || durationSec < 1) return 0
  if (durationSec >= 300) return 12
  if (durationSec >= 180) return 9
  if (durationSec >= 60) return 6
  return 3
}

/**
 * 为单个视频生成关键帧截图（均匀分布，避开首尾第一帧与最后一帧）。
 * 仅当视频本地可读、时长有效且目录中不存在同名文件时执行。
 * 容错：单帧失败继续下一帧；返回实际生成数与失败明细。
 */
export async function generateKeyframesForVideo(
  ffmpegPath: string,
  videoPath: string,
  sha256: string,
  durationSec: number | null,
  fps: number | null
): Promise<{ shots: KeyframeShot[]; generated: number; failed: string[] }> {
  const count = keyframeCountFor(durationSec)
  const result: KeyframeShot[] = []
  const failed: string[] = []

  if (count === 0 || !sha256) {
    if (durationSec !== null && durationSec < 1) {
      console.log(`[videomanager] 关键帧跳过（时长不足 1 秒）: ${videoPath}`)
    }
    return { shots: result, generated: 0, failed }
  }

  const dir = keyframeDir()
  mkdirSync(dir, { recursive: true })

  const dur = durationSec as number
  const effFps = fps && fps > 0 ? fps : null
  let generated = 0

  // 均匀分布：在 (0, duration) 内取 count 个点，避开首帧与末帧 → t_i = dur * i/(count+1), i=1..count
  for (let i = 1; i <= count; i++) {
    const timeSec = (dur * i) / (count + 1)
    const seq = String(i).padStart(2, '0')
    const name = `Keyframe_${sha256}_${seq}.jpg`
    const outPath = join(dir, name)
    try {
      // 体积控制：限制在 960×960 内等比缩放（横屏 960 宽 / 竖屏 960 高），JPEG 质量 q4。
      // 关键帧仅用于概览/详情预览，960px 足够清晰；原分辨率 + q2 在 4K 下单帧可达数 MB，
      // 缩放到 960 后体积缩小 90%+（实测 4K 4.9MB → 90KB）。
      await execFileAsync(
        ffmpegPath,
        [
          '-v', 'error',
          '-ss', timeSec.toFixed(3),
          '-i', videoPath,
          '-frames:v', '1',
          '-vf', 'scale=960:960:force_original_aspect_ratio=decrease',
          '-q:v', '4',
          '-y', outPath
        ],
        { timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 }
      )
      if (!existsSync(outPath)) throw new Error('输出文件不存在')
      result.push({
        name,
        timeSec: Math.round(timeSec * 1000) / 1000,
        frameNo: effFps ? Math.max(1, Math.ceil(timeSec * effFps)) : 0,
        v: 2
      })
      generated++
    } catch (err) {
      // 单帧失败不中断：继续截取下一张
      failed.push(`${name}(${timeSec.toFixed(1)}s): ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (generated > 0) {
    getDb()
      .prepare('UPDATE videos SET keyframes = ?, frame_count = ?, fps = COALESCE(?, fps) WHERE sha256 = ?')
      .run(
        JSON.stringify(result),
        effFps ? Math.round(dur * effFps) : null,
        effFps,
        sha256
      )
  }
  return { shots: result, generated, failed }
}

/** 生成所有已存在关键帧文件路径（供导出 zip 遍历） */
export function existingKeyframeFiles(sha256: string): string[] {
  const shots = parseKeyframes(
    (getDb().prepare('SELECT keyframes FROM videos WHERE sha256 = ?').get(sha256) as
      | { keyframes: string | null }
      | undefined)?.keyframes ?? null
  )
  const dir = keyframeDir()
  return shots.map((s) => join(dir, s.name)).filter((p) => existsSync(p))
}
