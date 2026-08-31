import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { ACCENTS, type AccentKey, type ThemeMode } from '../theme'

const MEDIA = window.matchMedia('(prefers-color-scheme: dark)')

const VALID_ACCENTS = new Set(Object.keys(ACCENTS))

/** 兼容旧存储键：非法/过期的配色名回退到晴空 */
function safeAccent(v: string | null): AccentKey {
  return v && VALID_ACCENTS.has(v) ? (v as AccentKey) : 'sky'
}

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>(
    (localStorage.getItem('vm-theme-mode') as ThemeMode) || 'auto'
  )
  const accent = ref<AccentKey>(safeAccent(localStorage.getItem('vm-theme-accent')))
  const systemDark = ref(MEDIA.matches)

  MEDIA.addEventListener('change', (e) => {
    systemDark.value = e.matches
  })

  const resolved = computed<'light' | 'dark'>(() =>
    mode.value === 'auto' ? (systemDark.value ? 'dark' : 'light') : mode.value
  )

  function setMode(m: ThemeMode): void {
    mode.value = m
    localStorage.setItem('vm-theme-mode', m)
  }

  function setAccent(a: AccentKey): void {
    accent.value = a
    localStorage.setItem('vm-theme-accent', a)
  }

  return { mode, accent, resolved, systemDark, setMode, setAccent }
})
