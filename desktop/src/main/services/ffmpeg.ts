import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface FfmpegPaths {
  ffmpeg: string
  ffprobe: string
}

/**
 * 定位 ffmpeg/ffprobe，优先级：
 * 1) 打包形态：extraResources 放到 <resources>/ffmpeg 的真实文件（asar 内 exe 无法被 child_process 执行）
 * 2) 从 <appPath> 向上逐级查找 resources/ffmpeg（覆盖 dev / 文件启动两种形态；跳过 asar 内虚拟路径）
 * 3) 环境变量 VM_FFMPEG_DIR
 * 4) PATH
 */
export function resolveFfmpegPaths(appPath: string): FfmpegPaths {
  // 打包后 process.resourcesPath = <exe>/resources，extraResources 把 ffmpeg 放其 ffmpeg/ 子目录
  const resFfmpeg = join(process.resourcesPath ?? '', 'ffmpeg')
  if (existsSync(join(resFfmpeg, 'ffmpeg.exe')) && existsSync(join(resFfmpeg, 'ffprobe.exe'))) {
    return { ffmpeg: join(resFfmpeg, 'ffmpeg.exe'), ffprobe: join(resFfmpeg, 'ffprobe.exe') }
  }

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

/**
 * 从起始目录向上（最多 5 层）查找包含 ffmpeg.exe + ffprobe.exe 的 resources/ffmpeg 目录。
 * 打包形态下 appPath 是 app.asar 虚拟路径：asar 内文件可被 fs 读到，但其中的 exe
 * 无法被 child_process 启动，因此含 .asar 的候选一律跳过，继续向上找真实目录。
 */
function findFfmpegDir(startDir: string): string | null {
  let dir = startDir
  for (let i = 0; i < 6; i++) {
    if (dir.includes('.asar')) {
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
      continue
    }
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
