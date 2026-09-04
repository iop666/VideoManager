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
  /** 帧率（avg_frame_rate 解析，如 "30000/1001" → 29.97） */
  fps: number | null
}

interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
}

interface FfprobeFormat {
  duration?: string
  format_name?: string
}

interface FfprobeJson {
  streams?: FfprobeStream[]
  format?: FfprobeFormat
}

/** 解析 ffprobe 帧率字符串："30000/1001" / "25" / "0" / "N/A" → number | null */
function parseRate(raw: string | undefined): number | null {
  if (!raw || raw === 'N/A' || raw === '0/0') return null
  const m = /^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/.exec(raw.trim())
  if (!m) return null
  const num = Number(m[1])
  const den = m[2] ? Number(m[2]) : 1
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null
  const v = num / den
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null
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

  // 优先 avg_frame_rate；缺省时回退 r_frame_rate
  const fps = parseRate(video?.avg_frame_rate) ?? parseRate(video?.r_frame_rate)

  return {
    duration: data.format?.duration ? Number(data.format.duration) : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    format: data.format?.format_name?.split(',')[0] ?? null,
    fps
  }
}
