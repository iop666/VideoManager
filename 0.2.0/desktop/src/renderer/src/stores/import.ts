import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useAppStore } from './app'
import type { ImportFolder, Task, TaskStatus } from '../../../shared/types'

const TERMINAL: ReadonlySet<TaskStatus> = new Set(['done', 'failed', 'cancelled'])

export const useImportStore = defineStore('import', () => {
  const folders = ref<ImportFolder[]>([])
  const tasks = ref<Task[]>([])
  const foldersLoading = ref(false)

  let unsubscribe: (() => void) | null = null
  const prevStatus = new Map<number, TaskStatus>()

  /** 订阅主进程任务变更（App 挂载时调用一次） */
  function subscribe(): void {
    if (unsubscribe) return
    unsubscribe = window.api.onTasksChanged((list) => {
      const appStore = useAppStore()
      let anyFinished = false
      for (const t of list) {
        const prev = prevStatus.get(t.id)
        if (prev !== undefined && prev !== t.status && TERMINAL.has(t.status)) {
          anyFinished = true
        }
        prevStatus.set(t.id, t.status)
      }
      tasks.value = list
      // 有任务结束 → 刷新统计（视频库/设置页数据）与导入文件夹（扫描后更新 last_scanned_at）
      if (anyFinished) {
        void appStore.loadInfo()
        void loadFolders()
      }
    })
  }

  async function loadFolders(): Promise<void> {
    foldersLoading.value = true
    try {
      folders.value = await window.api.listImportFolders()
    } finally {
      foldersLoading.value = false
    }
  }

  /** 弹窗选择文件夹并添加 */
  async function addFolder(): Promise<boolean> {
    const path = await window.api.selectFolder()
    if (!path) return false
    await window.api.addImportFolder({ path, recursive: true })
    await loadFolders()
    return true
  }

  async function removeFolder(id: number): Promise<void> {
    await window.api.removeImportFolder(id)
    await loadFolders()
  }

  /** 触发扫描（入队） */
  async function scanFolder(id: number): Promise<void> {
    await window.api.scanImportFolder(id)
  }

  async function loadTasks(): Promise<void> {
    tasks.value = await window.api.listTasks()
    for (const t of tasks.value) prevStatus.set(t.id, t.status)
  }

  return {
    folders,
    tasks,
    foldersLoading,
    subscribe,
    loadFolders,
    addFolder,
    removeFolder,
    scanFolder,
    loadTasks
  }
})
