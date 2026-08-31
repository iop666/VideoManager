// 生成播放器图标（复刻参考图：深底青蓝主图 + 白底/蓝底/灰底 3 变体）
// 用法：node scripts/generate-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

// ============ 主题参数（可选配色） ============
// 每个主题：bg 渐变、ring 渐变（青→蓝沿弧）、三角填充、三角描边、阴影强度
function themeSvg(p) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0.15" y1="0.08" x2="0.9" y2="0.95">
      <stop offset="0" stop-color="${p.bgA}"/>
      <stop offset="0.55" stop-color="${p.bgB}"/>
      <stop offset="1" stop-color="${p.bgC}"/>
    </linearGradient>
    <linearGradient id="ring" x1="0.3" y1="0.08" x2="0.72" y2="0.92">
      <stop offset="0" stop-color="${p.ringA}"/>
      <stop offset="0.28" stop-color="${p.ringB}"/>
      <stop offset="0.58" stop-color="${p.ringC}"/>
      <stop offset="1" stop-color="${p.ringD}"/>
    </linearGradient>
    <linearGradient id="tri" x1="0.2" y1="0" x2="0.7" y2="1">
      <stop offset="0" stop-color="${p.triA}"/>
      <stop offset="1" stop-color="${p.triB}"/>
    </linearGradient>
    <filter id="triShadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="${p.triShadowY}" stdDeviation="${p.triShadowBlur}" flood-color="#000000" flood-opacity="${p.triShadowOp}"/>
    </filter>
    <filter id="ringShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="${p.ringShadowOp}"/>
    </filter>
  </defs>

  <rect x="0" y="0" width="1024" height="1024" fill="${p.corner}"/>
  <rect x="46" y="46" width="932" height="932" rx="206" fill="url(#bg)"/>
  <rect x="47" y="47" width="930" height="930" rx="205" fill="none" stroke="#FFFFFF" stroke-opacity="${p.edgeHi}" stroke-width="2"/>

  <path d="M 814 323 A 356 356 0 1 1 524 156" fill="none" stroke="url(#ring)" stroke-width="${p.ringW}" stroke-linecap="round" filter="url(#ringShadow)"/>
  <path d="M 560 166 A 356 356 0 0 1 700 156" fill="none" stroke="#FFFFFF" stroke-opacity="${p.ringHi}" stroke-width="${p.ringW}" stroke-linecap="round"/>

  <path d="M 430 330 L 660 512 L 430 640 Z"
        fill="url(#tri)" stroke="url(#tri)" stroke-width="${p.triStroke}" stroke-linejoin="round"
        filter="url(#triShadow)"/>
  <path d="M 430 330 L 660 512 L 430 640 Z"
        fill="none" stroke="#FFFFFF" stroke-opacity="${p.triHi}" stroke-width="5" stroke-linejoin="round"/>
</svg>`
}

// ============ 主题定义（对照参考图采样） ============
const themes = {
  // 深底青蓝（主图）：背景深蓝灰、环青蓝渐变、三角近白
  main: {
    corner: '#1A1F28', bgA: '#333C4C', bgB: '#232933', bgC: '#141920',
    ringA: '#45ECFD', ringB: '#33BAF3', ringC: '#295BF0', ringD: '#2D7DFD',
    triA: '#F5F8FF', triB: '#D9DEEB', triStroke: 24,
    triHi: 0.12, triShadowY: 8, triShadowBlur: 14, triShadowOp: 0.32,
    ringW: 80, ringHi: 0.08, ringShadowOp: 0.25, edgeHi: 0.06
  },
  // 白底蓝环（变体1）
  white: {
    corner: '#E7E9EE', bgA: '#FFFFFF', bgB: '#F3F5F9', bgC: '#DFE5EE',
    ringA: '#3FD0FA', ringB: '#2FB6F4', ringC: '#2A5DF0', ringD: '#2E7DFD',
    triA: '#FFFFFF', triB: '#E8ECF5', triStroke: 22,
    triHi: 0.10, triShadowY: 5, triShadowBlur: 10, triShadowOp: 0.18,
    ringW: 78, ringHi: 0.10, ringShadowOp: 0.12, edgeHi: 0.10
  },
  // 蓝底白环（变体2）
  blue: {
    corner: '#1E5FE8', bgA: '#3D7DFC', bgB: '#2C6BF3', bgC: '#1F55E0',
    ringA: '#7FE8FE', ringB: '#4FC4F8', ringC: '#2E7FFC', ringD: '#3B8CFE',
    triA: '#FFFFFF', triB: '#E6F0FF', triStroke: 22,
    triHi: 0.15, triShadowY: 6, triShadowBlur: 12, triShadowOp: 0.25,
    ringW: 78, ringHi: 0.15, ringShadowOp: 0.20, edgeHi: 0.12
  },
  // 灰底深环（变体3）
  gray: {
    corner: '#9DA0A6', bgA: '#C9CCD2', bgB: '#B4B8C0', bgC: '#A2A6B0',
    ringA: '#7E838C', ringB: '#6F767F', ringC: '#5B626B', ringD: '#676E78',
    triA: '#F2F3F5', triB: '#D4D7DC', triStroke: 22,
    triHi: 0.10, triShadowY: 5, triShadowBlur: 10, triShadowOp: 0.18,
    ringW: 78, ringHi: 0.06, ringShadowOp: 0.15, edgeHi: 0.10
  }
}

function buildSvg(name) {
  const p = themes[name]
  if (!p) throw new Error('unknown theme ' + name)
  return themeSvg(p)
}

async function render(name, size) {
  return sharp(Buffer.from(buildSvg(name))).resize(size, size).png().toBuffer()
}

async function main() {
  // 主图：Android legacy mipmap
  const mipmaps = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }
  for (const [dpi, size] of Object.entries(mipmaps)) {
    const dir = join(root, 'android', 'android', 'app', 'src', 'main', 'res', 'mipmap-' + dpi)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'ic_launcher.png'), await render('main', size))
    console.log('android mipmap-' + dpi)
  }
  // 自适应
  const fgDir = join(root, 'android', 'android', 'app', 'src', 'main', 'res', 'mipmap-anydpi-v26')
  mkdirSync(fgDir, { recursive: true })
  writeFileSync(join(fgDir, 'ic_launcher_foreground.png'), await render('main', 432))
  writeFileSync(join(fgDir, 'ic_launcher.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>')
  const valuesDir = join(root, 'android', 'android', 'app', 'src', 'main', 'res', 'values')
  mkdirSync(valuesDir, { recursive: true })
  writeFileSync(join(valuesDir, 'colors.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#1A1F28</color>\n</resources>')
  console.log('android adaptive')

  // Windows
  const outDir = join(root, 'desktop', 'resources')
  mkdirSync(outDir, { recursive: true })
  const png = await render('main', 256)
  writeFileSync(join(outDir, 'icon.png'), png)
  const ico = Buffer.concat([
    Buffer.from([0, 0, 1, 0, 1, 0]),
    Buffer.from([0, 0, 0, 0, 0, 0, 1, 0, 32, 0]),
    Buffer.from([png.length % 256, Math.floor(png.length / 256) % 256, Math.floor(png.length / 65536) % 256, Math.floor(png.length / 16777216)]),
    Buffer.from([22, 0, 0, 0]),
    png
  ])
  writeFileSync(join(outDir, 'icon.ico'), ico)
  console.log('desktop icon.png + icon.ico')

  // 3 个变体（供预览/选择）
  const vdir = join(root, 'desktop', 'icon-variants')
  mkdirSync(vdir, { recursive: true })
  for (const name of ['white', 'blue', 'gray']) {
    writeFileSync(join(vdir, name + '.png'), await render(name, 256))
  }
  console.log('3 variants in desktop/icon-variants/')
  console.log('done')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})