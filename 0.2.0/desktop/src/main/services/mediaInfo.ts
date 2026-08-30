import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface MediaInfo {
  /** 时长（秒） */
  duration: number | null
  width: number | null
  height: number | null
  videoCodec: string | null
  audioCodec: string | null
  /** 容器格式（format_name 首项） */
  format: string | null
}

interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
}

interface FfprobeFormat {
  duration?: string
  format_name?: string
}

interface FfprobeJson {
  streams?: FfprobeStream[]
  format?: FfprobeFormat
}

/**
 * 调用 ffprobe 提取视频元数据。
 * 失败（文件损坏/非视频）时抛出异常，由调用方决定跳过或标记。
 */
export async function probeMedia(ffprobePath: string, filePath: string): Promise<MediaInfo> {
  const { stdout } = await execFileAsync(
    ffprobePath,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: 60000 }
  )
  const data = JSON.parse(stdout) as FfprobeJson
  const video = data.streams?.find((s) => s.codec_type === 'video')
  const audio = data.streams?.find((s) => s.codec_type === 'audio')

  return {
    duration: data.format?.duration ? Number(data.format.duration) : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    format: data.format?.format_name?.split(',')[0] ?? null
  }
}
