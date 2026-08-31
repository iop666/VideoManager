/** 分类/标签/作者可设置的颜色板（统计页新建/改名共用） */
export const META_COLORS = [
  '#FF8533', '#5B9BFF', '#3ECF6E', '#A78BFA', '#FF6B5E', '#FF7A9E',
  '#4FB3C9', '#7C90C0', '#D08B5A', '#F0A8BB', '#F2D24A', '#8B6CF0'
]

/** 新建时随机取一个色板颜色 */
export function randomMetaColor(): string {
  return META_COLORS[Math.floor(Math.random() * META_COLORS.length)]
}
