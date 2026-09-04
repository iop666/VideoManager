import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { getSetting, setSetting } from '../db'
import type { PlayerDetectResult, PlayerPlayResult } from '../../shared/types'

const execFileAsync = promisify(execFile)

const COMMON_PATHS = [
  'C:\\Program Files\\DAUM\\PotPlayer\\PotPlayerMini64.exe',
  'C:\\Program Files\\DAUM\\PotPlayer\\PotPlayerMini.exe',
  'C:\\Program Files (x86)\\DAUM\\PotPlayer\\PotPlayerMini64.exe',
  'C:\\Program Files (x86)\\DAUM\\PotPlayer\\PotPlayerMini.exe',
  'C:\\PotPlayer\\PotPlayerMini64.exe',
  'D:\\PotPlayer\\PotPlayerMini64.exe',
  'D:\\PotPlayer\\PotPlayerMini.exe'
]

const REG_KEYS = [
  'HKCU\\Software\\DAUM\\PotPlayer64',
  'HKCU\\Software\\DAUM\\PotPlayer',
  'HKLM\\Software\\DAUM\\PotPlayer64',
  'HKLM\\Software\\DAUM\\PotPlayer',
  'HKLM\\Software\\WOW6432Node\\DAUM\\PotPlayer64',
  'HKLM\\Software\\WOW6432Node\\DAUM\\PotPlayer'
]

/** 检测 PotPlayer：设置 → 注册表 → 常见路径 */
export async function detectPotPlayer(): Promise<PlayerDetectResult> {
  const configured = getSetting('potplayer_path')
  if (configured && existsSync(configured)) {
    return { path: configured, error: null }
  }

  for (const key of REG_KEYS) {
    try {
      const { stdout } = await execFileAsync('reg', ['query', key, '/v', 'InstallPath'], {
        windowsHide: true,
        timeout: 5000
      })
      const m = stdout.match(/InstallPath\s+REG_SZ\s+(.+)/)
      if (m) {
        const dir = m[1].trim()
        for (const exe of ['PotPlayerMini64.exe', 'PotPlayerMini.exe']) {
          const candidate = `${dir}\\${exe}`
          if (existsSync(candidate)) return { path: candidate, error: null }
        }
      }
    } catch {
      // 该注册表键不存在，继续
    }
  }

  for (const p of COMMON_PATHS) {
    if (existsSync(p)) return { path: p, error: null }
  }

  return { path: null, error: '未找到 PotPlayer，请在设置中手动指定路径' }
}

/** 调用 PotPlayer 播放文件（分离进程，不阻塞主进程） */
export async function playWithPotPlayer(videoPath: string): Promise<PlayerPlayResult> {
  const detected = await detectPotPlayer()
  if (!detected.path) return { ok: false, player: null, error: detected.error ?? '未找到 PotPlayer' }
  if (!existsSync(videoPath)) {
    return { ok: false, player: detected.path, error: '视频文件不存在（可能已被移动或删除）' }
  }
  try {
    const child = spawn(detected.path, [videoPath], {
      windowsHide: true,
      detached: true,
      stdio: 'ignore'
    })
    child.unref()
    return { ok: true, player: detected.path, error: null }
  } catch (err) {
    return { ok: false, player: detected.path, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 保存 PotPlayer 路径到设置 */
export function savePotPlayerPath(path: string): void {
  setSetting('potplayer_path', path.trim())
}
