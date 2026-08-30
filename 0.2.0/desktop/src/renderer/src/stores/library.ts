import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import { useAppStore } from './app'
import type { SortDir, SortField, VideoListItem, VideoListQuery } from '../../../shared/types'

export const useLibraryStore = defineStore('library', () => {
  const items = ref<VideoListItem[]>([])
  const total = ref(0)
  const loading = ref(false)
  const detailVideoId = ref<number | null>(null)

  const query = reactive<VideoListQuery>({
    page: 1,
    pageSize: 50,
    search: '',
    categoryId: null,
    tagId: null,
    authorId: null,
    favorite: false,
    orientation: null,
    includeMissing: false,
    sortBy: 'date_added',
    sortDir: 'desc'
  })

  /** 从设置读取每页数量并应用 */
  async function loadPageSize(): Promise<void> {
    query.pageSize = await window.api.getPageSize()
    query.page = 1
  }

  async function load(): Promise<void> {
    loading.value = true
    try {
      const res = await window.api.listVideos({ ...query })
      items.value = res.items
      total.value = res.total
    } finally {
      loading.value = false
    }
  }

  function setSearch(s: string): void {
    query.search = s
    query.page = 1
    void load()
  }

  function setCategory(id: number | null): void {
    query.categoryId = id
    query.page = 1
    void load()
  }

  function setTag(id: number | null): void {
    query.tagId = id
    query.page = 1
    void load()
  }

  function setFavorite(f: boolean): void {
    query.favorite = f
    query.page = 1
    void load()
  }

  /** 仅显示本地存在（关闭则包含已缺失文件） */
  function setOnlyLocal(v: boolean): void {
    query.includeMissing = !v
    query.page = 1
    void load()
  }

  function setSort(field: SortField, dir: SortDir): void {
    query.sortBy = field
    query.sortDir = dir
    query.page = 1
    void load()
  }

  function setPage(p: number): void {
    query.page = p
    void load()
  }

  function openDetail(id: number): void {
    detailVideoId.value = id
  }

  function closeDetail(): void {
    detailVideoId.value = null
  }

  /** 详情修改后刷新该条记录与统计 */
  async function refreshItem(id: number): Promise<void> {
    const updated = await window.api.getVideo(id)
    const idx = items.value.findIndex((i) => i.id === id)
    if (updated && idx !== -1) items.value[idx] = updated
    void useAppStore().loadInfo()
  }

  return {
    items,
    total,
    loading,
    query,
    detailVideoId,
    load,
    loadPageSize,
    setSearch,
    setCategory,
    setTag,
    setFavorite,
    setOnlyLocal,
    setSort,
    setPage,
    openDetail,
    closeDetail,
    refreshItem
  }
})
