import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AppInfo } from '../../../shared/types'

export const useAppStore = defineStore('app', () => {
  const info = ref<AppInfo | null>(null)
  const loading = ref(false)

  async function loadInfo(): Promise<void> {
    loading.value = true
    try {
      info.value = await window.api.getAppInfo()
    } finally {
      loading.value = false
    }
  }

  return { info, loading, loadInfo }
})
