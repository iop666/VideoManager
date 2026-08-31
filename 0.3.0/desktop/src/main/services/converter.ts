import { app } from 'electron'
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { getDb, getSetting } from '../db'
import { resolveFfmpegPaths } from './ffmpeg'
import { generateThumbnail } from './thumbnailer'
import { probeMedia } from './mediaInfo'
import { VIDEO_EXTENSIONS } from './scanner'

export type ConvertFormat = 'mp4' | 'mkv' | 'webm'

export interface ConvertOptions {
  /** 源文件路径（导入制；videoId 为可选，用于关联原库记录） */
  filePath: string
  videoId?: number
  format: ConvertFormat
  /** 画质 CRF（18 高质量 ~ 28 低质量） */
  crf: number
  /** 目标宽度（等比缩放），null = 原始分辨率 */
  scale?: number | null
  /**
   * 输出目录模式：
   * - 具体目录字符串 → 输出到该目录
   * - 'source' → 文件原目录
   * - null → 设置项 convert_output_dir 或 <原目录>/converted
   */
  outputDir?: string | 'source' | null
  /** 转换成功后删除源文件 */
  deleteSource: boolean
}

export interface ConvertResult {
  videoId: number
  outputPath: string
}

/** 转换文件信息（导入清单用） */
export interface ConvertFileInfo {
  path: string
  name: string
  size: number
  duration: number | null
  format: string | null
}

/**
 * FFmpeg 转码：
 * - mp4/mkv → libx264 + aac；webm → libvpx-vp9 + libopus
 * - 进度通过 -progress pipe:1 的 out_time_us 解析
 * - 完成后写入视频库（输出文件若已在库中则更新，否则插入新记录）
 */
export async function convertFile(
  options: ConvertOptions,
  onProgress?: (pct: number) => void
): Promise<ConvertResult> {
  const filePath = options.filePath
  if (!existsSync(filePath)) throw new Error(`源文件不存在：${filePath}`)

  const { ffmpeg } = resolveFfmpegPaths(app.getAppPath())

  // 输出目录：source → 原目录；字符串 → 该目录；null → 设置或 converted/
  let outDir: string
  if (options.outputDir === 'source') {
    outDir = dirname(filePath)
  } else if (typeof options.outputDir === 'string' && options.outputDir.trim()) {
    outDir = options.outputDir.trim()
  } else {
    outDir = getSetting('convert_output_dir') || join(dirname(filePath), 'converted')
  }
  mkdirSync(outDir, { recursive: true })

  const baseName = basename(filePath, extname(filePath))
  const outPath = join(outDir, `${baseName}.${options.format}`)

  const args = ['-v', 'error', '-nostats', '-progress', 'pipe:1', '-y', '-i', filePath]
  if (options.scale && options.scale > 0) {
    args.push('-vf', `scale=${options.scale}:-2`)
  }
  if (options.format === 'webm') {
    args.push('-c:v', 'libvpx-vp9', '-crf', String(options.crf), '-b:v', '0', '-c:a', 'libopus', '-b:a', '128k')
  } else {
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(options.crf), '-c:a', 'aac', '-b:a', '128k')
  }
  args.push(outPath)

  // 源时长（进度计算用）
  const sourceInfo = await probeMedia(resolveFfmpegPaths(app.getAppPath()).ffprobe, filePath)
  await runFfmpeg(ffmpeg, args, sourceInfo.duration, onProgress)

  // —— 完成：写入视频库 ——
  const fileStat = await stat(outPath)
  const info = await probeMedia(resolveFfmpegPaths(app.getAppPath()).ffprobe, outPath)
  const title = basename(outPath, extname(outPath))
  const db = getDb()

  let newId: number
  const existing = db.prepare('SELECT id FROM videos WHERE file_path = ?').get(outPath) as
    | { id: number }
    | undefined
  if (existing) {
    db.prepare(
      `UPDATE videos SET title = ?, file_size = ?, duration = ?, width = ?, height = ?,
       codec = ?, audio_codec = ?, format = ?, status = 'ready', date_modified = ?
       WHERE id = ?`
    ).run(title, fileStat.size, info.duration, info.width, info.height, info.videoCodec,
      info.audioCodec, options.format, new Date(fileStat.mtimeMs).toISOString(), existing.id)
    newId = existing.id
  } else {
    const res = db
      .prepare(
        `INSERT INTO videos (title, file_path, file_name, file_size, duration, width, height,
                             codec, audio_codec, format, date_modified, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')`
      )
      .run(
        title, outPath, basename(outPath), fileStat.size, info.duration, info.width, info.height,
        info.videoCodec, info.audioCodec, options.format, new Date(fileStat.mtimeMs).toISOString()
      )
    newId = Number(res.lastInsertRowid)
  }

  // 缩略图：优先复制源记录缩略图（若提供 videoId），否则重新截帧
  const thumbDir = getSetting('thumbnail_dir') ?? join(app.getPath('userData'), 'thumbnails')
  const newThumb = join(thumbDir, `${newId}.jpg`)
  try {
    const srcThumb = options.videoId
      ? (db.prepare('SELECT thumbnail_path FROM videos WHERE id = ?').get(options.videoId) as
          | { thumbnail_path: string | null }
          | undefined)?.thumbnail_path
      : null
    if (srcThumb && existsSync(srcThumb)) {
      copyFileSync(srcThumb, newThumb)
      db.prepare('UPDATE videos SET thumbnail_path = ? WHERE id = ?').run(newThumb, newId)
    } else {
      const ok = await generateThumbnail(ffmpeg, outPath, newThumb, info.duration)
      if (ok) db.prepare('UPDATE videos SET thumbnail_path = ? WHERE id = ?').run(newThumb, newId)
    }
  } catch {
    // 缩略图失败不阻断
  }

  if (options.deleteSource) {
    try {
      rmSync(filePath, { force: true })
      if (options.videoId) {
        db.prepare("UPDATE videos SET status = 'missing' WHERE id = ?").run(options.videoId)
      }
    } catch {
      // 删除失败不阻断
    }
  }

  return { videoId: newId, outputPath: outPath }
}

/** 探测一组文件的时长/大小（并行，限制并发） */
export async function inspectFiles(paths: string[]): Promise<ConvertFileInfo[]> {
  const { ffprobe } = resolveFfmpegPaths(app.getAppPath())
  const result: ConvertFileInfo[] = []
  const CONCURRENCY = 4
  let index = 0
  const worker = async (): Promise<void> => {
    while (index < paths.length) {
      const p = paths[index++]
      try {
        const st = await stat(p)
        const info = await probeMedia(ffprobe, p)
        result.push({
          path: p,
          name: basename(p),
          size: st.size,
          duration: info.duration,
          format: extname(p).slice(1).toLowerCase()
        })
      } catch {
        // 探测失败的文件跳过
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, paths.length) }, worker))
  return result
}

/** 收集文件夹下的视频文件（递归） */
export function collectVideoFilesInFolder(folder: string): Promise<string[]> {
  // 复用 scanner 的收集逻辑
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return new Promise<string[]>((resolve, reject) => {
    void (async () => {
      try {
        const { readdir } = await import('node:fs/promises')
        const { join: pJoin } = await import('node:path')
        const files: string[] = []
        const walk = async (dir: string): Promise<void> => {
          const entries = await readdir(dir, { withFileTypes: true })
          for (const entry of entries) {
            const full = pJoin(dir, entry.name)
            if (entry.isDirectory()) {
              await walk(full)
            } else if (entry.isFile() && VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
              files.push(full)
            }
          }
        }
        await walk(folder)
        resolve(files)
      } catch (err) {
        reject(err)
      }
    })()
  })
}

/** 运行 ffmpeg 并解析 -progress 输出，进度 0~1 */
function runFfmpeg(
  ffmpegPath: string,
  args: string[],
  durationSec: number | null,
  onProgress?: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdoutBuf = ''
    let stderrBuf = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString()
      const lines = stdoutBuf.split('\n')
      stdoutBuf = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('out_time_us=')) {
          const us = Number(line.split('=')[1])
          if (durationSec && durationSec > 0 && us > 0) {
            onProgress?.(Math.min(us / 1e6 / durationSec, 1))
          }
        }
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString()
      if (stderrBuf.length > 8192) stderrBuf = stderrBuf.slice(-8192)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderrBuf.trim().split('\n').pop() ?? `ffmpeg 退出码 ${code}`))
    })
  })
}
