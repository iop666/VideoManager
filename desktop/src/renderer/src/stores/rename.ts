import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import type { RenamePreviewItem, RenameResult, RenameRules } from '../../../shared/types'

export const useRenameStore = defineStore('rename', () => {
  const rules = reactive<RenameRules>({
    prefix: '',
    suffix: ''
  })
  const preview = ref<RenamePreviewItem[]>([])
  const result = ref<RenameResult | null>(null)
  const undoAvailable = ref(false)
  const loading = ref(false)

  async function buildPreview(
    videos: Array<{ id?: number; filePath: string; title: string }>
  ): Promise<void> {
    loading.value = true
    try {
      preview.value = await window.api.renamePreview(videos, { ...rules })
    } finally {
      loading.value = false
    }
  }

  async function apply(): Promise<void> {
    // 深拷贝：preview.value 是 reactive Proxy，Electron IPC 无法克隆
    const plan = JSON.parse(JSON.stringify(preview.value)) as RenamePreviewItem[]
    result.value = await window.api.renameApply(plan)
    undoAvailable.value = result.value.undoAvailable
  }

  async function undo(): Promise<void> {
    result.value = await window.api.renameUndo()
    undoAvailable.value = result.value.undoAvailable
  }

  async function refreshUndo(): Promise<void> {
    undoAvailable.value = await window.api.renameUndoAvailable()
  }

  function reset(): void {
    preview.value = []
    result.value = null
  }

  return {
    rules,
    preview,
    result,
    undoAvailable,
    loading,
    buildPreview,
    apply,
    undo,
    refreshUndo,
    reset
  }
})
