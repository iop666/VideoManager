import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AppInfo, MetaSortConfig } from '../../../shared/types'

const DEFAULT_META_SORT: MetaSortConfig = {
  category: { by: 'name', dir: 'asc' },
  author: { by: 'count', dir: 'desc' },
  tag: { by: 'name', dir: 'asc' }
}

export const useAppStore = defineStore('app', () => {
  const info = ref<AppInfo | null>(null)
  const loading = ref(false)

  /** 每页显示数量（与设置页双向同步，改后立即生效） */
  const pageSize = ref(42)
  /** 视频库封面显示模式：landscape=横屏比例 / normal=正常比例 */
  const coverMode = ref<'landscape' | 'normal'>('landscape')
  /** 元数据编辑页下拉列表排序配置（分类/作者/标签：名称或数量 × 正倒） */
  const metaEditSort = ref<MetaSortConfig>({ ...DEFAULT_META_SORT, category: { ...DEFAULT_META_SORT.category }, author: { ...DEFAULT_META_SORT.author }, tag: { ...DEFAULT_META_SORT.tag } })

  async function loadInfo(): Promise<void> {
    loading.value = true
    try {
      info.value = await window.api.getAppInfo()
    } finally {
      loading.value = false
    }
  }

  /** 从设置读取每页数量与封面模式 */
  async function loadDisplaySettings(): Promise<void> {
    const [ps, cm] = await Promise.all([window.api.getPageSize(), window.api.getCoverMode()])
    pageSize.value = ps
    coverMode.value = (cm as 'landscape' | 'normal') || 'landscape'
  }

  async function applyPageSize(v: number): Promise<number> {
    pageSize.value = await window.api.setPageSize(v)
    return pageSize.value
  }

  async function applyCoverMode(v: 'landscape' | 'normal'): Promise<'landscape' | 'normal'> {
    coverMode.value = (await window.api.setCoverMode(v)) as 'landscape' | 'normal'
    return coverMode.value
  }

  /** 元数据编辑下拉排序配置读写（设置页修改后广播到各编辑抽屉） */
  async function loadMetaEditSort(): Promise<MetaSortConfig> {
    metaEditSort.value = await window.api.getMetaEditSort()
    return metaEditSort.value
  }

  async function applyMetaEditSort(cfg: MetaSortConfig): Promise<MetaSortConfig> {
    metaEditSort.value = await window.api.setMetaEditSort(cfg)
    return metaEditSort.value
  }

  /** 左侧导航点击视频库/元数据时的刷新信号（视图监听后重载列表，保留筛选） */
  const navTick = ref(0)
  function bumpNavTick(): void {
    navTick.value++
  }

  return {
    info,
    loading,
    pageSize,
    coverMode,
    metaEditSort,
    navTick,
    loadInfo,
    loadDisplaySettings,
    applyPageSize,
    applyCoverMode,
    loadMetaEditSort,
    applyMetaEditSort,
    bumpNavTick
  }
})
