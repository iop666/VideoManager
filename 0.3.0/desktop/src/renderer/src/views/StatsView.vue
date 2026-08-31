<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NGrid,
  NGridItem,
  NInput,
  NModal,
  NSpin,
  NStatistic,
  NTag,
  useMessage
} from 'naive-ui'
import { useMetaStore } from '../stores/meta'
import { formatBytes, formatDurationCN } from '../utils/format'
import { META_COLORS, randomMetaColor } from '../utils/metaColors'
import type { StatsSummary } from '../../../shared/types'
import MetaListSection from '../components/MetaListSection.vue'

const router = useRouter()
const meta = useMetaStore()
const message = useMessage()

const stats = ref<StatsSummary | null>(null)
const loading = ref(true)

// 新建对话框（含颜色选择）
const createOpen = ref(false)
const createType = ref<'category' | 'tag' | 'author'>('category')
const createName = ref('')
const createColor = ref<string | null>(null)
const creating = ref(false)

// 各区块排序：名称 / 数量 × 升 / 降
const sortState = ref<Record<'category' | 'tag' | 'author', { by: 'name' | 'count'; dir: 'asc' | 'desc' }>>({
  category: { by: 'count', dir: 'desc' },
  tag: { by: 'count', dir: 'desc' },
  author: { by: 'count', dir: 'desc' }
})

function sorted<T extends { name: string; videoCount: number }>(
  items: T[],
  key: 'category' | 'tag' | 'author'
): T[] {
  const s = sortState.value[key]
  const list = [...items]
  list.sort((a, b) => {
    const cmp =
      s.by === 'name'
        ? a.name.localeCompare(b.name, 'zh-Hans-CN')
        : a.videoCount - b.videoCount
    return s.dir === 'asc' ? cmp : -cmp
  })
  return list
}

const sortedCategories = computed(() => sorted(meta.categories, 'category'))
const sortedTags = computed(() => sorted(meta.tags, 'tag'))
const sortedAuthors = computed(() => sorted(meta.authors, 'author'))

onMounted(async () => {
  await load()
  void meta.load()
})

async function load(): Promise<void> {
  loading.value = true
  try {
    stats.value = await window.api.getStatsSummary()
  } finally {
    loading.value = false
  }
}

function openCreate(type: 'category' | 'tag' | 'author'): void {
  createType.value = type
  createName.value = ''
  createColor.value = randomMetaColor()
  createOpen.value = true
}

const typeLabel = computed(() =>
  createType.value === 'category' ? '分类' : createType.value === 'tag' ? '标签' : '作者'
)

async function confirmCreate(): Promise<void> {
  if (!createName.value.trim()) {
    message.warning('请输入名称')
    return
  }
  creating.value = true
  try {
    const name = createName.value.trim()
    if (createType.value === 'category') {
      const res = await window.api.addCategory(name, createColor.value)
      if ('error' in res) message.error(res.error)
      else message.success(`已新建分类「${name}」`)
    } else if (createType.value === 'tag') {
      const res = await window.api.addTag(name, createColor.value)
      if ('error' in res) message.error(res.error)
      else message.success(`已新建标签「${name}」`)
    } else {
      const res = await window.api.addAuthor(name, createColor.value)
      if ('error' in res) message.error(res.error)
      else message.success(`已新建作者「${name}」`)
    }
    await Promise.all([load(), meta.load()])
    createOpen.value = false
  } finally {
    creating.value = false
  }
}

async function renameItem(
  type: 'category' | 'tag' | 'author',
  id: number,
  name: string,
  color: string | null
): Promise<void> {
  let error: string | undefined
  if (type === 'category') error = (await window.api.updateCategory(id, name, color)).error
  else if (type === 'tag') error = (await window.api.updateTag(id, name, color)).error
  else error = (await window.api.updateAuthor(id, name, color)).error
  if (error) {
    message.error(error)
    return
  }
  message.success('已重命名')
  await Promise.all([load(), meta.load()])
}

async function removeItem(type: 'category' | 'tag' | 'author', id: number): Promise<void> {
  if (type === 'category') await window.api.removeCategory(id)
  else if (type === 'tag') await window.api.removeTag(id)
  else await window.api.removeAuthor(id)
  await Promise.all([load(), meta.load()])
  message.success('已删除')
}

function goToCategoryFilter(id: number): void {
  router.push({ path: '/library', query: { categoryId: String(id) } })
}

function goToTagFilter(id: number): void {
  router.push({ path: '/library', query: { tagId: String(id) } })
}
</script>

<template>
  <div class="page">
    <h2>标签管理</h2>
    <p class="muted">集中管理视频的分类、标签与作者：排序、新建、重命名、删除，点击「查看」跳转对应筛选列表。</p>

    <n-spin :show="loading">
      <template v-if="stats">
        <n-grid cols="4" :x-gap="16" :y-gap="16">
          <n-grid-item>
            <n-card size="small">
              <n-statistic label="视频总数" :value="stats.totalVideos" />
            </n-card>
          </n-grid-item>
          <n-grid-item>
            <n-card size="small">
              <n-statistic label="总时长" :value="formatDurationCN(stats.totalDuration)" />
            </n-card>
          </n-grid-item>
          <n-grid-item>
            <n-card size="small">
              <n-statistic label="总大小" :value="formatBytes(stats.totalSize)" />
            </n-card>
          </n-grid-item>
          <n-grid-item>
            <n-card size="small">
              <n-statistic
                label="已建身份（哈希）"
                :value="`${stats.hashedVideos}/${stats.totalVideos}`"
              />
            </n-card>
          </n-grid-item>
        </n-grid>

        <!-- 方向统计（并入总览） -->
        <div class="orient-line">
          <span class="orient-item">横屏 <b>{{ stats.orientation.landscape }}</b></span>
          <span class="orient-item">竖屏 <b>{{ stats.orientation.portrait }}</b></span>
          <span class="orient-item">方形 <b>{{ stats.orientation.square }}</b></span>
          <n-button size="tiny" quaternary @click="router.push({ path: '/library', query: { orientation: 'landscape' } })">查看横屏</n-button>
          <n-button size="tiny" quaternary @click="router.push({ path: '/library', query: { orientation: 'portrait' } })">查看竖屏</n-button>
        </div>

        <!-- 分类管理（横向列表） -->
        <MetaListSection
          style="margin-top: 16px"
          title="分类"
          subtitle="管理视频分类"
          :items="sortedCategories"
          :sort-by="sortState.category.by"
          :sort-dir="sortState.category.dir"
          :show-view="true"
          empty-text="暂无分类"
          @update:sort-by="(v) => (sortState.category.by = v)"
          @update:sort-dir="(v) => (sortState.category.dir = v)"
          @create="openCreate('category')"
          @view="goToCategoryFilter"
          @rename="(id, name, color) => renameItem('category', id, name, color)"
          @remove="(id) => removeItem('category', id)"
        />

        <!-- 标签管理（Chip 网格） -->
        <MetaListSection
          style="margin-top: 16px"
          title="标签"
          subtitle="管理视频标签"
          :items="sortedTags"
          :sort-by="sortState.tag.by"
          :sort-dir="sortState.tag.dir"
          :chip-mode="true"
          :show-view="true"
          empty-text="暂无标签"
          @update:sort-by="(v) => (sortState.tag.by = v)"
          @update:sort-dir="(v) => (sortState.tag.dir = v)"
          @create="openCreate('tag')"
          @view="goToTagFilter"
          @rename="(id, name, color) => renameItem('tag', id, name, color)"
          @remove="(id) => removeItem('tag', id)"
        />

        <!-- 作者管理（横向列表） -->
        <MetaListSection
          style="margin-top: 16px"
          title="作者"
          subtitle="管理视频作者"
          :items="sortedAuthors"
          :sort-by="sortState.author.by"
          :sort-dir="sortState.author.dir"
          empty-text="暂无作者"
          @update:sort-by="(v) => (sortState.author.by = v)"
          @update:sort-dir="(v) => (sortState.author.dir = v)"
          @create="openCreate('author')"
          @rename="(id, name, color) => renameItem('author', id, name, color)"
          @remove="(id) => removeItem('author', id)"
        />

        <div class="section-title">重复文件（SHA-256 审查）</div>
        <n-card size="small">
          <template v-if="stats.duplicates.length">
            <n-alert type="warning" :show-icon="false" style="margin-bottom: 12px">
              发现 {{ stats.duplicates.length }} 组重复视频（内容完全相同，SHA-256 一致）。建议保留一份，删除其余。
            </n-alert>
            <div v-for="(g, gi) in stats.duplicates" :key="gi" class="dup-group">
              <div class="dup-head">
                <n-tag type="error" size="small" :bordered="false">重复 ×{{ g.count }}</n-tag>
                <span class="dup-hash">{{ g.hash.slice(0, 20) }}…</span>
              </div>
              <div v-for="item in g.items" :key="item.id" class="dup-item">
                <span>{{ item.title }}</span>
                <span class="stat-count">{{ formatBytes(item.fileSize) }}</span>
              </div>
            </div>
          </template>
          <n-empty v-else description="未发现重复视频" />
        </n-card>
      </template>
      <n-empty v-else-if="!loading" description="暂无数据" />
    </n-spin>

    <n-modal v-model:show="createOpen" preset="card" style="width: 380px" :title="`新建${typeLabel}`">
      <n-input
        v-model:value="createName"
        :placeholder="`输入${typeLabel}名称`"
        @keyup.enter="confirmCreate"
      />
      <div class="create-color-label">颜色（已随机选择，可点击色盘精确调整）</div>
      <div class="mini-swatches">
        <button
          v-for="col in META_COLORS"
          :key="col"
          class="mini-swatch"
          :class="{ active: createColor === col }"
          :style="{ background: col }"
          @click="createColor = createColor === col ? null : col"
        />
        <label class="mini-picker" :title="'自定义颜色（当前：' + (createColor ?? '无') + '）'">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22a10 10 0 1 1 10-10c0 1.7-1.3 3-3 3h-2.2a2.8 2.8 0 0 0-2 4.8c.4.4.6.9.6 1.4 0 .7-.6 1.2-1.2 1.6-.8.4-1.5.7-2.2 1.2z" />
            <circle cx="7.5" cy="11.5" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="10.5" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="15" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="18" cy="10.5" r="1.2" fill="currentColor" stroke="none" />
          </svg>
          <span class="mini-picker-dot" :style="{ background: createColor ?? '#888888' }" />
          <input
            type="color"
            :value="createColor ?? '#888888'"
            @input="(e: Event) => (createColor = (e.target as HTMLInputElement).value)"
          />
        </label>
      </div>
      <template #footer>
        <div style="display: flex; justify-content: flex-end; gap: 8px">
          <n-button quaternary @click="createOpen = false">取消</n-button>
          <n-button type="primary" :loading="creating" @click="confirmCreate">新建</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
  margin: 24px 0 10px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.stat-count {
  font-size: 12px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.orient-line {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-top: 16px;
  padding: 10px 16px;
  border-radius: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  font-size: 13px;
  color: var(--text-2);
  flex-wrap: wrap;
}

.orient-item b {
  color: var(--accent);
  font-variant-numeric: tabular-nums;
  margin-left: 2px;
}

.mini-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.mini-swatch {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 0.12s;
}

.mini-swatch:hover {
  transform: scale(1.1);
}

.mini-swatch.active {
  border-color: var(--text-1);
  box-shadow: 0 0 0 2px var(--bg-canvas);
}

.mini-picker {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--border-strong);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  overflow: hidden;
  position: relative;
  background: var(--bg-elevated);
  color: var(--text-2);
}

.mini-picker:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.mini-picker-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
  flex-shrink: 0;
}

.mini-picker input[type='color'] {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  border: none;
  padding: 0;
}

.create-color-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  margin: 14px 0 8px;
}

.dup-group + .dup-group {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.dup-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.dup-hash {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  color: var(--text-3);
}

.dup-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 3px 0 3px 4px;
  font-size: 12px;
  color: var(--text-2);
}
</style>
