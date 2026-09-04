/** 时长格式化：1234 秒 → "20:34" / "2:03:14" */
export function formatDuration(sec: number | null): string {
  if (sec === null || !isFinite(sec)) return '--:--'
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(r).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

/** 中文时长格式化：xx 分钟 xx 秒；低于 1 分钟显示 xx 秒；超过 1 小时显示 xx 小时 xx 分钟 */
export function formatDurationCN(sec: number | null): string {
  if (sec === null || !isFinite(sec)) return '--'
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h} 小时 ${m} 分钟`
  if (m > 0) return `${m} 分钟 ${r} 秒`
  return `${r} 秒`
}

/** 文件大小格式化 */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '--'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes
  let u = -1
  do {
    v /= 1024
    u++
  } while (v >= 1024 && u < units.length - 1)
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[u]}`
}
