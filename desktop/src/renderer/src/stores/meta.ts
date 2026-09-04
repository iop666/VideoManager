import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Author, Category, Tag } from '../../../shared/types'

export const useMetaStore = defineStore('meta', () => {
  const categories = ref<Category[]>([])
  const tags = ref<Tag[]>([])
  const authors = ref<Author[]>([])
  const loading = ref(false)

  async function load(): Promise<void> {
    loading.value = true
    try {
      const [c, t, a] = await Promise.all([
        window.api.listCategories(),
        window.api.listTags(),
        window.api.listAuthors()
      ])
      categories.value = c
      tags.value = t
      authors.value = a
    } finally {
      loading.value = false
    }
  }

  async function addCategory(name: string): Promise<Category | { error: string }> {
    const res = await window.api.addCategory(name)
    await load()
    return res
  }

  /** 分类下拉选项（含「全部分类 / 无分类」由调用方处理） */
  const categoryOptions = (): { label: string; value: number }[] =>
    categories.value.map((c) => ({ label: `${c.name}（${c.videoCount}）`, value: c.id }))

  const tagOptions = (): { label: string; value: number }[] =>
    tags.value.map((t) => ({ label: `${t.name}（${t.videoCount}）`, value: t.id }))

  const authorOptions = (): { label: string; value: number }[] =>
    authors.value.map((a) => ({ label: `${a.name}（${a.videoCount}）`, value: a.id }))

  return {
    categories,
    tags,
    authors,
    loading,
    load,
    categoryOptions,
    tagOptions,
    authorOptions
  }
})
