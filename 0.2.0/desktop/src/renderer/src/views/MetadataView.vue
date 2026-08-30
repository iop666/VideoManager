<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  NButton,
  NEmpty,
  NIcon,
  NInput,
  NModal,
  NPagination,
  NSelect,
  NSpin,
  NTag,
  useMessage
} from 'naive-ui'
import { GridOutline, ListOutline, TrashOutline, CreateOutline, SearchOutline, Heart, HeartOutline } from '@vicons/ionicons5'
import { useMetaStore } from '../stores/meta'
import { formatBytes, formatDuration } from '../utils/format'
import ThumbImg from '../components/ThumbImg.vue'
import MetaEditDrawer from '../components/MetaEditDrawer.vue'
import type { Orientation, SortDir, SortField, VideoListItem } from '../../../shared/types'

const meta = useMetaStore()
const message = useMessage()

const items = ref<VideoListItem[]>([])
const total = ref(0)
const page = ref(1)
/** 每页显示数量（从设置读取，与视频库同步） */
const pageSize = ref(50)
const loading = ref(false)

/** 显示范围：全部 / 仅显示本地 / 仅显示收藏 / 隐藏本地（默认全部） */
const scopeMode = ref<'all' | 'local' | 'favorite' | 'hidden'>('all')

const scopeOptions = [
  { label: '显示全部', value: 'all' },
  { label: '仅显示本地', value: 'local' },
  { label: '仅显示收藏', value: 'favorite' },
  { label: '隐藏本地', value: 'hidden' }
]

const viewMode = ref<'grid' | 'list'>(
  (localStorage.getItem('vm-meta-view') as 'grid' | 'list') || 'grid'
)

// 筛选与排序（与视频库一致）
const search = ref('')
const categoryId = ref<number | null>(null)
const tagId = ref<number | null>(null)
const authorId = ref<number | null>(null)
const orientation = ref<Orientation | null>(null)
const sortBy = ref<SortField>('date_added')
const sortDir = ref<SortDir>('desc')

const sortOptions: { label: string; value: SortField }[] = [
  { label: '加入时间', value: 'date_added' },
  { label: '标题', value: 'title' },
  { label: '时长', value: 'duration' },
  { label: '评分', value: 'rating' },
  { label: '文件大小', value: 'file_size' },
  { label: '播放次数', value: 'play_count' }
]

const dirOptions: { label: string; value: SortDir }[] = [
  { label: '降序', value: 'desc' },
  { label: '升序', value: 'asc' }
]

const orientationOptions: { label: string; value: Orientation }[] = [
  { label: '横屏', value: 'landscape' },
  { label: '竖屏', value: 'portrait' }
]

const categoryOptions = computed(() => meta.categoryOptions())
const tagOptions = computed(() => meta.tagOptions())
const authorOptions = computed(() => meta.authorOptions())

const editId = ref<number | null>(null)

// 删除确认
const deleteTarget = ref<VideoListItem | null>(null)
const deleting = ref(false)

// 清空全部确认
const clearAllOpen = ref(false)
const clearing = ref(false)
const clearResult = ref<number | null>(null)

onMounted(async () => {
  void meta.load()
  // 读取每页显示设置（与视频库同步）
  pageSize.value = await window.api.getPageSize()
  await load()
})

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await window.api.listVideos({
      page: page.value,
      pageSize: pageSize.value,
      search: search.value,
      categoryId: categoryId.value,
      tagId: tagId.value,
      authorId: authorId.value,
      orientation: orientation.value,
      includeMissing: scopeMode.value !== 'local' && scopeMode.value !== 'hidden',
      hideLocal: scopeMode.value === 'hidden',
      favorite: scopeMode.value === 'favorite',
      sortBy: sortBy.value,
      sortDir: sortDir.value
    })
    items.value = res.items
    total.value = res.total
  } finally {
    loading.value = false
  }
}

function reload(): void {
  page.value = 1
  void load()
}

function setScope(v: 'all' | 'local' | 'favorite' | 'hidden'): void {
  scopeMode.value = v
  reload()
}

function setViewMode(mode: 'grid' | 'list'): void {
  viewMode.value = mode
  localStorage.setItem('vm-meta-view', mode)
}

/** 切换收藏（心形按钮） */
async function toggleFavorite(v: VideoListItem): Promise<void> {
  await window.api.updateVideo(v.id, { isFavorite: v.isFavorite !== 1 })
  await load()
}

async function doRemove(deleteFile: boolean): Promise<void> {
  const target = deleteTarget.value
  if (!target) return
  deleting.value = true
  try {
    const res = await window.api.removeVideo(target.id, deleteFile)
    if (res.ok) {
      message.success(deleteFile ? '已删除记录与本地文件' : '已移除记录（文件保留）')
      deleteTarget.value = null
      await Promise.all([load(), meta.load()])
    } else {
      message.error(res.error ?? '删除失败')
    }
  } finally {
    deleting.value = false
  }
}

async function doClearAll(): Promise<void> {
  clearing.value = true
  try {
    const res = await window.api.clearAllVideos()
    clearResult.value = res.count
    clearAllOpen.value = false
    await Promise.all([load(), meta.load()])
    message.success(`已清空 ${res.count} 条视频数据（本地文件保留）`)
  } finally {
    clearing.value = false
  }
}
</script>

<template>
  <div class="page library-page">
    <!-- 筛选工具栏（与视频库一致） -->
    <div class="toolbar">
      <n-select
        :value="scopeMode"
        :options="scopeOptions"
        style="width: 140px"
        @update:value="setScope"
      />
      <n-select
        :value="categoryId"
        :options="categoryOptions"
        placeholder="全部分类"
        clearable
        style="width: 150px"
        @update:value="(v: number | null) => { categoryId = v; reload() }"
      />
      <n-select
        :value="tagId"
        :options="tagOptions"
        placeholder="全部标签"
        clearable
        style="width: 150px"
        @update:value="(v: number | null) => { tagId = v; reload() }"
      />
      <n-select
        :value="authorId"
        :options="authorOptions"
        placeholder="全部作者"
        clearable
        style="width: 150px"
        @update:value="(v: number | null) => { authorId = v; reload() }"
      />
      <n-select
        :value="orientation"
        :options="orientationOptions"
        placeholder="全部方向"
        clearable
        style="width: 110px"
        @update:value="(v: Orientation | null) => { orientation = v; reload() }"
      />
      <n-select
        :value="sortBy"
        :options="sortOptions"
        style="width: 110px"
        @update:value="(v: SortField) => { sortBy = v; reload() }"
      />
      <n-select
        :value="sortDir"
        :options="dirOptions"
        style="width: 84px"
        @update:value="(v: SortDir) => { sortDir = v; reload() }"
      />
      <n-input
        :value="search"
        clearable
        placeholder="搜索标题 / 文件名..."
        style="width: 220px"
        @update:value="(v: string) => { search = v; reload() }"
      >
        <template #prefix>
          <n-icon><SearchOutline /></n-icon>
        </template>
      </n-input>
      <div class="spacer" />
      <n-button size="small" type="error" secondary @click="clearAllOpen = true">
        <template #icon><n-icon><TrashOutline /></n-icon></template>
        清空全部数据
      </n-button>
      <div class="view-toggle">
        <button
          class="view-btn"
          :class="{ active: viewMode === 'grid' }"
          title="网格视图"
          @click="setViewMode('grid')"
        >
          <n-icon><GridOutline /></n-icon>
        </button>
        <button
          class="view-btn"
          :class="{ active: viewMode === 'list' }"
          title="列表视图"
          @click="setViewMode('list')"
        >
          <n-icon><ListOutline /></n-icon>
        </button>
      </div>
    </div>
    <div class="count-line">
      共 {{ total }} 条 · 以 SHA-256 为唯一身份
    </div>

    <n-spin :show="loading">
      <template v-if="items.length">
        <div v-if="viewMode === 'grid'" class="grid">
          <div v-for="v in items" :key="v.id" class="card">
            <div class="thumb-wrap" @click="editId = v.id">
              <ThumbImg :video-id="v.id" :thumbnail-path="v.thumbnailPath" />
              <span class="dur">{{ formatDuration(v.duration) }}</span>
              <span v-if="v.status === 'missing'" class="missing-tag">缺失</span>
              <button
                class="fav-btn"
                :class="{ active: v.isFavorite === 1 }"
                :title="v.isFavorite === 1 ? '取消收藏' : '收藏'"
                @click.stop="toggleFavorite(v)"
              >
                <n-icon :size="15"><Heart v-if="v.isFavorite === 1" /><HeartOutline v-else /></n-icon>
              </button>
            </div>
            <div class="card-title" :title="v.title" @click="editId = v.id">{{ v.title }}</div>
            <div class="card-meta">
              <span>{{ formatBytes(v.fileSize) }}</span>
              <span v-if="v.sha256">· {{ v.sha256.slice(0, 10) }}…</span>
            </div>
            <div class="card-actions">
              <n-button size="tiny" @click="editId = v.id">
                <template #icon><n-icon><CreateOutline /></n-icon></template>
                编辑
              </n-button>
              <n-button size="tiny" type="error" quaternary @click="deleteTarget = v">
                <template #icon><n-icon><TrashOutline /></n-icon></template>
              </n-button>
            </div>
          </div>
        </div>
        <div v-else class="list">
          <div v-for="v in items" :key="v.id" class="list-item">
            <div class="list-thumb" @click="editId = v.id">
              <ThumbImg :video-id="v.id" :thumbnail-path="v.thumbnailPath" />
              <span v-if="v.status === 'missing'" class="missing-tag">缺失</span>
            </div>
            <div class="list-body" @click="editId = v.id">
              <div class="list-title">{{ v.title }}</div>
              <div class="list-meta">
                <span>{{ formatBytes(v.fileSize) }}</span>
                <span v-if="v.sha256" class="list-hash">· {{ v.sha256 }}</span>
              </div>
            </div>
            <button
              class="list-fav-btn"
              :class="{ active: v.isFavorite === 1 }"
              :title="v.isFavorite === 1 ? '取消收藏' : '收藏'"
              @click.stop="toggleFavorite(v)"
            >
              <n-icon :size="17"><Heart v-if="v.isFavorite === 1" /><HeartOutline v-else /></n-icon>
            </button>
            <div class="list-actions">
              <n-button size="tiny" @click="editId = v.id">编辑</n-button>
              <n-button size="tiny" type="error" quaternary @click="deleteTarget = v">删除</n-button>
            </div>
          </div>
        </div>
      </template>
      <n-empty v-else description="没有视频数据" style="margin-top: 48px" />
    </n-spin>

    <div class="pager">
      <n-pagination
        :page="page"
        :item-count="total"
        :page-size="pageSize"
        :page-slot="7"
        show-quick-jumper
        @update:page="(p: number) => { page = p; void load() }"
      />
    </div>

    <!-- 编辑抽屉：保存后自动关闭并刷新列表 -->
    <MetaEditDrawer
      :video-id="editId"
      @close="editId = null"
      @updated="() => { editId = null; void load() }"
    />

    <!-- 清空全部确认 -->
    <n-modal
      :show="clearAllOpen"
      preset="card"
      style="width: 440px"
      title="清空全部视频数据？"
      @update:show="(v: boolean) => !v && (clearAllOpen = false)"
    >
      <p class="del-text">
        将移除<strong>全部</strong>视频记录、缩略图与元数据（共 {{ total }} 条），
        <strong>不会删除任何本地文件</strong>。此操作不可撤销。
      </p>
      <template #footer>
        <n-space justify="end">
          <n-button quaternary @click="clearAllOpen = false">取消</n-button>
          <n-button type="error" :loading="clearing" @click="doClearAll">确认清空</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 删除确认 -->
    <n-modal
      :show="deleteTarget !== null"
      preset="card"
      style="width: 420px"
      title="删除视频数据"
      @update:show="(v: boolean) => !v && (deleteTarget = null)"
    >
      <p class="del-text">
        将删除「{{ deleteTarget?.title }}」的记录
        <span v-if="deleteTarget?.sha256" class="list-hash">（{{ deleteTarget.sha256.slice(0, 16) }}…）</span>
      </p>
      <template #footer>
        <n-space justify="end">
          <n-button quaternary @click="deleteTarget = null">取消</n-button>
          <n-button :loading="deleting" @click="doRemove(false)">仅移除记录</n-button>
          <n-button type="error" :loading="deleting" @click="doRemove(true)">移除并删除文件</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.library-page {
  max-width: none;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.spacer {
  flex: 1;
}

.count-line {
  color: var(--text-3);
  font-size: 12px;
  margin: 10px 0 14px;
  font-variant-numeric: tabular-nums;
}

.view-toggle {
  display: flex;
  gap: 2px;
  background: var(--bg-hover);
  border-radius: 8px;
  padding: 2px;
}

.view-btn {
  width: 32px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.view-btn.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
  margin-top: 14px;
}

.card {
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg-card);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-card);
}

.thumb-wrap {
  position: relative;
  aspect-ratio: 16 / 9;
  background: var(--bg-hover);
  cursor: pointer;
}

.dur {
  position: absolute;
  right: 8px;
  bottom: 8px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 6px;
  font-variant-numeric: tabular-nums;
}

.missing-tag {
  position: absolute;
  left: 8px;
  top: 8px;
  background: rgba(220, 38, 38, 0.85);
  color: #fff;
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 6px;
  font-weight: 600;
}

.fav-btn {
  position: absolute;
  left: 8px;
  top: 8px;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #ffffff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
}

.fav-btn:hover {
  transform: scale(1.12);
}

.fav-btn.active {
  color: #ff5c7a;
}

.list-fav-btn {
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s, transform 0.15s;
}

.list-fav-btn:hover {
  background: var(--bg-hover);
  color: var(--text-1);
  transform: scale(1.08);
}

.list-fav-btn.active {
  color: #ff5c7a;
}

.card-title {
  font-size: 13px;
  font-weight: 600;
  padding: 8px 12px 2px;
  color: var(--text-1);
  cursor: pointer;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 55px;
}

.card-meta {
  padding: 0 12px 6px;
  font-size: 10px;
  color: var(--text-3);
}

.card-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 8px;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}

.list-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
}

.list-thumb {
  position: relative;
  width: 120px;
  height: 68px;
  flex-shrink: 0;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-hover);
  cursor: pointer;
}

.list-body {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.list-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.list-meta {
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-3);
  word-break: break-all;
}

.list-hash {
  font-family: 'JetBrains Mono', Consolas, monospace;
}

.list-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.pager {
  display: flex;
  justify-content: center;
  margin-top: 20px;
}

.del-text {
  color: var(--text-1);
  font-size: 14px;
  word-break: break-all;
}
</style>
