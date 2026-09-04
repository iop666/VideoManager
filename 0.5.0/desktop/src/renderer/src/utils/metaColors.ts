/** 分类/标签/作者可设置的固定颜色板（展示/选择用） */
export const META_COLORS = [
  '#FF8533', '#5B9BFF', '#3ECF6E', '#A78BFA', '#FF6B5E', '#FF7A9E',
  '#4FB3C9', '#7C90C0', '#D08B5A', '#F0A8BB', '#F2D24A', '#8B6CF0'
]

/** 完全随机的鲜艳颜色（HSL 全色域随机，饱和度/亮度适中保证可读） */
export function randomMetaColor(): string {
  const h = Math.floor(Math.random() * 360)
  const s = 55 + Math.floor(Math.random() * 35) // 55% ~ 90%
  const l = 40 + Math.floor(Math.random() * 30) // 40% ~ 70%
  return hslToHex(h, s, l)
}

/** HSL → HEX（#RRGGBB），用于完全随机取色 */
function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100
  const ln = l / 100
  const k = (n: number): number => (n + h / 30) % 12
  const a = sn * Math.min(ln, 1 - ln)
  const f = (n: number): string => {
    const c = ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}
