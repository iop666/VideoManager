// 小米设计语言主题（参考 XiaoMi/xiaomi-miloco design-tokens.md）
// 支持：明/暗两套 + 可切换配色（accent）
// 暗色: 画布 #0E0E0E / 卡片 #161616 / 品牌橙 #FF8533
// 亮色: 画布 #F4F5F7 / 卡片 #FFFFFF / 品牌橙 #FF6700

import type { GlobalThemeOverrides } from 'naive-ui'

export type ThemeMode = 'auto' | 'light' | 'dark'
export type AccentKey =
  | 'amber'
  | 'sky'
  | 'bamboo'
  | 'mist'
  | 'cinnabar'
  | 'rouge'
  | 'ultramarine'
  | 'indigo'
  | 'ochre'
  | 'lotus'
  | 'pines'

export interface Accent {
  name: string
  dark: string
  darkHover: string
  darkPressed: string
  light: string
  lightHover: string
  lightPressed: string
}

/** 中国色（参考 zhongguose.com 命名与色值，dark 取亮调、light 取深调保证对比） */
export const ACCENTS: Record<AccentKey, Accent> = {
  amber: {
    name: '琥珀',
    dark: '#FF8533',
    darkHover: '#FFA86B',
    darkPressed: '#FF6700',
    light: '#D97014',
    lightHover: '#F0852F',
    lightPressed: '#B85F10'
  },
  sky: {
    name: '晴空',
    dark: '#5B9BFF',
    darkHover: '#82B5FF',
    darkPressed: '#3B7DF5',
    light: '#2563EB',
    lightHover: '#4F83F0',
    lightPressed: '#1D4FC4'
  },
  bamboo: {
    name: '竹影',
    dark: '#3ECF6E',
    darkHover: '#63DC8C',
    darkPressed: '#2BBF60',
    light: '#2E9E57',
    lightHover: '#3CB96A',
    lightPressed: '#25854A'
  },
  mist: {
    name: '烟霞',
    dark: '#A78BFA',
    darkHover: '#C0ABFC',
    darkPressed: '#8B6CF0',
    light: '#7C5CF0',
    lightHover: '#977AF5',
    lightPressed: '#6749D8'
  },
  cinnabar: {
    name: '朱砂',
    dark: '#FF6B5E',
    darkHover: '#FF8F85',
    darkPressed: '#F0503F',
    light: '#C3272B',
    lightHover: '#DB4347',
    lightPressed: '#A51E22'
  },
  rouge: {
    name: '胭脂',
    dark: '#FF7A9E',
    darkHover: '#FF9DB9',
    darkPressed: '#F25C86',
    light: '#9D2933',
    lightHover: '#B23A46',
    lightPressed: '#832028'
  },
  ultramarine: {
    name: '群青',
    dark: '#4FB3C9',
    darkHover: '#74C6D8',
    darkPressed: '#359CB5',
    light: '#2E7D8F',
    lightHover: '#3A94A8',
    lightPressed: '#266879'
  },
  indigo: {
    name: '黛蓝',
    dark: '#7C90C0',
    darkHover: '#9AAAD1',
    darkPressed: '#6478AC',
    light: '#425066',
    lightHover: '#52617C',
    lightPressed: '#343F52'
  },
  ochre: {
    name: '赭石',
    dark: '#D08B5A',
    darkHover: '#E0A678',
    darkPressed: '#BE7443',
    light: '#85431E',
    lightHover: '#9C5227',
    lightPressed: '#6E3818'
  },
  lotus: {
    name: '藕荷',
    dark: '#F0A8BB',
    darkHover: '#F7C0CE',
    darkPressed: '#E68CA5',
    light: '#B76E79',
    lightHover: '#CC8590',
    lightPressed: '#9E5C66'
  },
  pines: {
    name: '松花',
    dark: '#F2D24A',
    darkHover: '#F8E078',
    darkPressed: '#E5C12E',
    light: '#B8911B',
    lightHover: '#D0A722',
    lightPressed: '#9A7915'
  }
}

interface Palette {
  canvas: string
  card: string
  hover: string
  elevated: string
  text1: string
  text2: string
  text3: string
  textDisabled: string
  border: string
  borderStrong: string
  shadow1: string
  shadow2: string
  shadow3: string
}

const PALETTES: Record<'light' | 'dark', Palette> = {
  dark: {
    canvas: '#0E0E0E',
    card: '#161616',
    hover: '#1F1F1F',
    elevated: '#2A2A2A',
    text1: '#F5F5F5',
    text2: '#B5B5B5',
    text3: '#888888',
    textDisabled: '#555555',
    border: '#2A2A2A',
    borderStrong: '#3A3A3A',
    shadow1: '0 1px 2px rgba(0,0,0,.40)',
    shadow2: '0 2px 8px rgba(0,0,0,.50)',
    shadow3: '0 8px 24px rgba(0,0,0,.60)'
  },
  light: {
    canvas: '#F4F5F7',
    card: '#FFFFFF',
    hover: '#EBEDEF',
    elevated: '#DDE1E6',
    text1: '#1F1F1F',
    text2: '#6B6B6B',
    text3: '#9A9A9A',
    textDisabled: '#C5C5C5',
    border: '#E5E5E5',
    borderStrong: '#CCCCCC',
    shadow1: '0 1px 2px rgba(0,0,0,.04)',
    shadow2: '0 2px 8px rgba(0,0,0,.06)',
    shadow3: '0 8px 24px rgba(0,0,0,.08)'
  }
}

/** 构建 Naive UI 主题覆盖（mode × accent） */
export function buildThemeOverrides(
  mode: 'light' | 'dark',
  accentKey: AccentKey
): GlobalThemeOverrides {
  const p = PALETTES[mode]
  const a = ACCENTS[accentKey]
  const accent = mode === 'dark' ? a.dark : a.light
  const accentHover = mode === 'dark' ? a.darkHover : a.lightHover
  const accentPressed = mode === 'dark' ? a.darkPressed : a.lightPressed
  const accentSoft = hexToRgba(accent, mode === 'dark' ? 0.1 : 0.08)
  const accentRing = hexToRgba(accent, mode === 'dark' ? 0.24 : 0.2)

  return {
    common: {
      primaryColor: accent,
      primaryColorHover: accentHover,
      primaryColorPressed: accentPressed,
      primaryColorSuppl: accent,
      infoColor: '#2563EB',
      infoColorHover: '#4F83F0',
      infoColorPressed: '#1D4FC4',
      successColor: '#16A34A',
      successColorHover: '#2BBF60',
      successColorPressed: '#128A3E',
      warningColor: '#D97706',
      warningColorHover: '#E8951F',
      warningColorPressed: '#B25F04',
      errorColor: '#DC2626',
      errorColorHover: '#EF4444',
      errorColorPressed: '#B91C1C',
      bodyColor: p.canvas,
      cardColor: p.card,
      modalColor: p.card,
      popoverColor: p.card,
      inputColor: p.card,
      tableColor: p.card,
      borderColor: p.border,
      dividerColor: p.border,
      textColorBase: p.text1,
      textColor1: p.text1,
      textColor2: p.text2,
      textColor3: p.text3,
      textColorDisabled: p.textDisabled,
      borderRadius: '8px',
      borderRadiusSmall: '6px',
      fontFamily:
        'MiSans, -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif',
      fontFamilyMono: '"JetBrains Mono", Consolas, "Courier New", monospace',
      fontWeightStrong: '600',
      hoverColor: accentSoft,
      pressedColor: hexToRgba(accentPressed, 0.14),
      boxShadow1: p.shadow1,
      boxShadow2: p.shadow2,
      boxShadow3: p.shadow3
    },
    Button: {
      borderRadiusTiny: '6px',
      borderRadiusSmall: '6px',
      borderRadiusMedium: '8px',
      borderRadiusLarge: '8px',
      fontWeight: '600'
    },
    Card: {
      borderRadius: '12px',
      color: p.card,
      borderColor: p.border
    },
    Layout: {
      color: p.canvas,
      siderColor: p.card,
      headerColor: p.card,
      headerBorderColor: p.border
    },
    Menu: {
      itemColorActive: accentSoft,
      itemColorActiveHover: accentSoft,
      itemTextColorActive: accent,
      itemTextColorActiveHover: accent,
      itemTextColorHover: p.text1,
      itemIconColorActive: accent,
      itemIconColorActiveHover: accent,
      itemHeight: '40px',
      borderRadius: '8px',
      color: p.card
    },
    DataTable: {
      borderRadius: '12px',
      thColor: p.card,
      tdColor: p.card,
      tdColorHover: p.hover,
      thTextColor: p.text2,
      borderColor: p.border
    },
    Dialog: {
      borderRadius: '16px',
      color: p.card
    },
    Drawer: {
      color: p.card,
      borderColor: p.border
    },
    Input: {
      color: p.card,
      colorFocus: p.card,
      borderColor: p.border,
      borderHover: p.borderStrong,
      borderFocus: accent,
      boxShadowFocus: `0 0 0 2px ${accentRing}`,
      borderRadius: '8px'
    },
    Select: {
      peers: {
        InternalSelection: {
          borderRadius: '8px',
          color: p.card,
          colorActive: p.card,
          border: `1px solid ${p.border}`,
          borderHover: `1px solid ${p.borderStrong}`,
          borderFocus: `1px solid ${accent}`,
          boxShadowFocus: `0 0 0 2px ${accentRing}`
        }
      }
    },
    Tag: {
      borderRadius: '6px'
    },
    Pagination: {
      itemBorderRadius: '8px',
      itemColorActive: accent,
      itemTextColorActive: '#FFFFFF'
    },
    Progress: {
      railColor: p.hover,
      color: accent
    },
    Switch: {
      railColorActive: accent,
      railColorActiveHover: accentHover
    },
    Notification: {
      borderRadius: '12px',
      color: p.card
    },
    Message: {
      borderRadius: '10px',
      color: p.card
    },
    Tabs: {
      tabTextColorActive: accent,
      tabColorSegment: accentSoft
    },
    Checkbox: {
      checkMarkColor: '#FFFFFF',
      colorChecked: accent,
      borderChecked: accent
    },
    Slider: {
      fillColor: accent,
      railColor: p.hover
    },
    Empty: {
      iconColor: p.textDisabled
    }
  }
}

/** #RRGGBB → rgba(r,g,b,a) */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
