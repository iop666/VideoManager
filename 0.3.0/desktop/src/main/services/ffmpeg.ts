import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface FfmpegPaths {
  ffmpeg: string
  ffprobe: string
}

/**
 * 定位 ffmpeg/ffprobe，优先级：
 * 1) 从 <appPath> 向上逐级查找 resources/ffmpeg（覆盖 dev / 文件启动 / 打包三种形态）
 * 2) 环境变量 VM_FFMPEG_DIR
 * 3) PATH
 */
export function resolveFfmpegPaths(appPath: string): FfmpegPaths {
  const bundled = findFfmpegDir(appPath)
  if (bundled) {
    return { ffmpeg: join(bundled, 'ffmpeg.exe'), ffprobe: join(bundled, 'ffprobe.exe') }
  }

  const envDir = process.env.VM_FFMPEG_DIR
  if (envDir) {
    const ffmpeg = join(envDir, 'ffmpeg.exe')
    const ffprobe = join(envDir, 'ffprobe.exe')
    if (existsSync(ffmpeg) && existsSync(ffprobe)) {
      return { ffmpeg, ffprobe }
    }
  }

  const onPathFfmpeg = findOnPath('ffmpeg')
  const onPathFfprobe = findOnPath('ffprobe')
  if (onPathFfmpeg && onPathFfprobe) {
    return { ffmpeg: onPathFfmpeg, ffprobe: onPathFfprobe }
  }

  throw new Error(
    '未找到 ffmpeg/ffprobe。请运行 scripts/download-ffmpeg.ps1，或设置环境变量 VM_FFMPEG_DIR。'
  )
}

/** 从起始目录向上（最多 5 层）查找包含 ffmpeg.exe + ffprobe.exe 的 resources/ffmpeg 目录 */
function findFfmpegDir(startDir: string): string | null {
  let dir = startDir
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, 'resources', 'ffmpeg')
    if (existsSync(join(candidate, 'ffmpeg.exe')) && existsSync(join(candidate, 'ffprobe.exe'))) {
      return candidate
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function findOnPath(name: string): string | null {
  const exe = `${name}.exe`
  for (const dir of (process.env.PATH ?? '').split(';')) {
    if (!dir) continue
    const candidate = join(dir, exe)
    if (existsSync(candidate)) return candidate
  }
  return null
}
