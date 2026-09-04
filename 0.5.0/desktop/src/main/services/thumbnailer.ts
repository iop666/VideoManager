import { execFile } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * 用 ffmpeg 截取一帧生成 JPEG 缩略图。
 * 取时长 10% 处（限制在 1~30 秒之间）。
 * 返回是否成功；失败（损坏文件等）返回 false，不影响导入流程。
 */
export async function generateThumbnail(
  ffmpegPath: string,
  videoPath: string,
  thumbPath: string,
  durationSec: number | null
): Promise<boolean> {
  try {
    mkdirSync(dirname(thumbPath), { recursive: true })
    const offset = durationSec ? Math.min(Math.max(durationSec * 0.1, 1), 30) : 1
    await execFileAsync(
      ffmpegPath,
      [
        '-v', 'error',
        '-ss', String(offset),
        '-i', videoPath,
        '-frames:v', '1',
        '-vf', 'scale=480:-2',
        '-q:v', '4',
        '-y', thumbPath
      ],
      { timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 }
    )
    return existsSync(thumbPath)
  } catch {
    return false
  }
}
