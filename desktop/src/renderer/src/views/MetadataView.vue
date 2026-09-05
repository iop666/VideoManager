<script setup lang="ts">
defineOptions({ name: 'MetadataView' })
import { computed, onActivated, onDeactivated, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  NButton,
  NCheckbox,
  NEmpty,
  NIcon,
  NInput,
  NModal,
  NPagination,
  NSelect,
  NSpace,
  NSpin,
  NTag,
  useMessage
} from 'naive-ui'
import { GridOutline, ListOutline, TrashOutline, CreateOutline, SearchOutline, Heart, HeartOutline } from '@vicons/ionicons5'
import { useAppStore } from '../stores/app'
import { useMetaStore } from '../stores/meta'
import { formatBytes, formatDuration } from '../utils/format'
import ThumbImg from '../components/ThumbImg.vue'
import MetaEditDrawer from '../components/MetaEditDrawer.vue'
import KeyframeDrawer from '../components/KeyframeDrawer.vue'
import type { BatchVideoPatch, Orientation, SortDir, SortField, VideoListItem } from '../../../shared/types'

const app = useAppStore()
const meta = useMetaStore()
const message = useMessage()
const route = useRoute()

const items = ref<VideoListItem[]>([])
const total = ref(0)
const page = ref(1)
/** 每页显示数量（从设置读取，与视频库同步；设置页修改后实时生效） */
const pageSize = ref(42)
const loading = ref(false)

/** 显示范围：全部 / 仅显示本地 / 仅显示收藏 / 隐藏本地 / 未分类（默认全部） */
const scopeMode = ref<'all' | 'local' | 'favorite' | 'hidden' | 'uncategorized'>('all')

const scopeOptions = [
  { label: '显示全部', value: 'all' },
  { label: '仅显示本地', value: 'local' },
  { label: '仅显示收藏', value: 'favorite' },
  { label: '隐藏本地', value: 'hidden' },
  { label: '未分类', value: 'uncategorized' }
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
  { label: '竖屏', value: 'portrait' },
  { label: '方形', value: 'square' }
]

const categoryOptions = computed(() => meta.categoryOptions())
const tagOptions = computed(() => meta.tagOptions())
const authorOptions = computed(() => meta.authorOptions())

const editId = ref<number | null>(null)

/** 右键打开关键帧截图概览 */
const keyframeVideo = ref<VideoListItem | null>(null)
function openKeyframes(v: VideoListItem): void {
  keyframeVideo.value = v
}
function closeKeyframes(): void {
  keyframeVideo.value = null
}

// 删除确认
const deleteTarget = ref<VideoListItem | null>(null)
const deleting = ref(false)

// 清空全部确认
const clearAllOpen = ref(false)
const clearing = ref(false)
const clearResult = ref<number | null>(null)
/** 整个数据库的记录总数（清空范围是全库，与当前筛选无关） */
const dbTotal = ref(0)

async function openClearAll(): Promise<void> {
  clearAllOpen.value = true
  try {
    const res = await window.api.listVideos({ page: 1, pageSize: 1, includeMissing: true })
    dbTotal.value = res.total
  } catch {
    dbTotal.value = 0
  }
}

// ============ 多选批量模式（左键长按进入 / 工具栏「多选」） ============
const batchMode = ref(false)
const selectedIds = ref<Set<number>>(new Set())
const batchDeleteOpen = ref(false)
const batchEditOpen = ref(false)
const batchBusy = ref(false)

const selectedCount = computed(() => selectedIds.value.size)

function isSelected(v: VideoListItem): boolean {
  return selectedIds.value.has(v.id)
}

function toggleSelect(v: VideoListItem): void {
  const next = new Set(selectedIds.value)
  if (next.has(v.id)) next.delete(v.id)
  else next.add(v.id)
  selectedIds.value = next
}

function selectAllPage(): void {
  const next = new Set(selectedIds.value)
  for (const item of items.value) next.add(item.id)
  selectedIds.value = next
}

function clearSelection(): void {
  selectedIds.value = new Set()
}

function startBatch(): void {
  batchMode.value = true
}

function enterBatch(v: VideoListItem): void {
  batchMode.value = true
  selectedIds.value = new Set([v.id])
}

function exitBatch(): void {
  batchMode.value = false
  selectedIds.value = new Set()
  batchDeleteOpen.value = false
  batchEditOpen.value = false
  batchRemark.value = ''
  batchRemarkClear.value = false
}

// 离开本页（keep-alive 切走）自动退出多选模式
onDeactivated(() => {
  if (batchMode.value) exitBatch()
})

/** 封面/标题点击：非批量 = 打开编辑；批量 = 切换选中；长按刚触发时抑制本次 click */
function onSelectAreaClick(v: VideoListItem): void {
  if (suppressNextClick) {
    suppressNextClick = false
    return
  }
  if (batchMode.value) toggleSelect(v)
  else editId.value = v.id
}

/** 卡片其余区域点击（批量模式才生效，避免误触） */
function onCardRootClick(v: VideoListItem, e: MouseEvent): void {
  if (suppressNextClick) {
    suppressNextClick = false
    return
  }
  if ((e.target as HTMLElement).closest('.sel-item')) return
  if (batchMode.value) toggleSelect(v)
}

function onCardContextmenu(v: VideoListItem): void {
  if (batchMode.value) toggleSelect(v)
  else openKeyframes(v)
}

// ---- 长按识别：按住 550ms 且位移 < 8px 进入多选并选中该视频 ----
let suppressNextClick = false
let longPressTimer: number | undefined
let pressVideo: VideoListItem | null = null
let pressX = 0
let pressY = 0

function clearLongPress(): void {
  if (longPressTimer !== undefined) {
    window.clearTimeout(longPressTimer)
    longPressTimer = undefined
  }
  pressVideo = null
}

function onCardPointerDown(v: VideoListItem, e: PointerEvent): void {
  if (batchMode.value || e.button !== 0) return
  const t = e.target as HTMLElement | null
  if (t && t.closest('.no-batch')) return // 按钮等交互区不触发长按
  pressVideo = v
  pressX = e.clientX
  pressY = e.clientY
  suppressNextClick = false
  longPressTimer = window.setTimeout(() => {
    longPressTimer = undefined
    const target = pressVideo
    pressVideo = null
    if (target) {
      suppressNextClick = true
      enterBatch(target)
    }
  }, 550)
}

function onCardPointerMove(e: PointerEvent): void {
  if (longPressTimer === undefined) return
  const dx = e.clientX - pressX
  const dy = e.clientY - pressY
  if (dx * dx + dy * dy > 64) clearLongPress() // 位移 > 8px 视为滚动/拖动
}

function onCardPointerUp(): void {
  clearLongPress()
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && batchMode.value) exitBatch()
})

// ---- 批量动作 ----
async function doBatchFavorite(favorite: boolean): Promise<void> {
  const ids = [...selectedIds.value]
  if (ids.length === 0) return
  batchBusy.value = true
  try {
    const res = await window.api.batchUpdateVideos(ids, { isFavorite: favorite })
    if (!res.ok) {
      message.error(res.error ?? '操作失败')
      return
    }
    message.success(`已${favorite ? '收藏' : '取消收藏'} ${ids.length} 条`)
    await Promise.all([load(), meta.load()])
    exitBatch()
  } finally {
    batchBusy.value = false
  }
}

function openBatchDelete(): void {
  if (selectedCount.value === 0) return
  batchDeleteOpen.value = true
}

async function doBatchRemove(deleteFile: boolean): Promise<void> {
  const ids = [...selectedIds.value]
  if (ids.length === 0) return
  batchBusy.value = true
  try {
    const res = await window.api.batchRemoveVideos(ids, deleteFile)
    if (!res.ok) {
      message.error(res.error ?? '删除失败')
      return
    }
    message.success(
      deleteFile
        ? `已移除 ${res.removed} 条记录（删除本地文件 ${res.deletedFiles} 个）`
        : `已移除 ${res.removed} 条记录（文件保留）`
    )
    batchDeleteOpen.value = false
    await Promise.all([load(), meta.load()])
    exitBatch()
  } finally {
    batchBusy.value = false
  }
}

// ---- 批量编辑弹窗状态（分类/作者/追加标签/备注） ----
/** 哨兵值：保持原样 / 清除 */
const BATCH_KEEP = -1
const BATCH_CLEAR = -2
const batchCat = ref<number>(BATCH_KEEP)
const batchAuthor = ref<number>(BATCH_KEEP)
const batchTags = ref<number[]>([])
const batchRemark = ref('')
const batchRemarkClear = ref(false)

const batchCatOptions = computed(() => [
  { label: '（保持原样）', value: BATCH_KEEP },
  { label: '（清除分类）', value: BATCH_CLEAR },
  ...meta.categoryOptions()
])
const batchAuthorOptions = computed(() => [
  { label: '（保持原样）', value: BATCH_KEEP },
  { label: '（清除作者）', value: BATCH_CLEAR },
  ...meta.authorOptions()
])
const batchTagOptions = computed(() => meta.tagOptions())

function openBatchEdit(): void {
  if (selectedCount.value === 0) return
  batchCat.value = BATCH_KEEP
  batchAuthor.value = BATCH_KEEP
  batchTags.value = []
  batchRemark.value = ''
  batchRemarkClear.value = false
  batchEditOpen.value = true
}

async function applyBatchEdit(): Promise<void> {
  const ids = [...selectedIds.value]
  if (ids.length === 0) return
  const patch: BatchVideoPatch = {}
  if (batchCat.value !== BATCH_KEEP) {
    patch.categoryId = batchCat.value === BATCH_CLEAR ? null : batchCat.value
  }
  if (batchAuthor.value !== BATCH_KEEP) {
    if (batchAuthor.value === BATCH_CLEAR) {
      patch.authorId = null
      patch.author = null
    } else {
      patch.authorId = batchAuthor.value
      patch.author = meta.authors.find((a) => a.id === batchAuthor.value)?.name ?? null
    }
  }
  if (batchRemarkClear.value) patch.remark = null
  else if (batchRemark.value.trim()) patch.remark = batchRemark.value.trim()

  const tagNames = batchTags.value
    .map((id) => meta.tags.find((t) => t.id === id)?.name)
    .filter((n): n is string => !!n)

  batchBusy.value = true
  try {
    let changed = 0
    if (Object.keys(patch).length > 0) {
      const res = await window.api.batchUpdateVideos(ids, patch)
      if (!res.ok) {
        message.error(res.error ?? '批量修改失败')
        return
      }
      changed = res.updated
    }
    if (tagNames.length > 0) {
      const res2 = await window.api.batchAppendVideoTags(ids, tagNames)
      if (!res2.ok) {
        message.error(res2.error ?? '批量添加标签失败')
        return
      }
      changed = Math.max(changed, res2.updated)
    }
    if (changed === 0) {
      message.warning('未做任何修改')
      return
    }
    message.success(`已更新 ${changed} 条元数据`)
    batchEditOpen.value = false
    await Promise.all([load(), meta.load()])
    exitBatch()
  } finally {
    batchBusy.value = false
  }
}

onMounted(async () => {
  void meta.load()
  // 读取每页显示设置（与视频库同步）
  await app.loadDisplaySettings()
  pageSize.value = app.pageSize
  await load()
})

/** 首次激活后，每次进入本页：同步最新每页数量并刷新列表（保留筛选条件） */
let firstActivation = true
let lastRefreshTs = 0
onActivated(() => {
  if (firstActivation) {
    firstActivation = false
    return
  }
  void refreshOnActive()
})

// 点击左侧导航「元数据」（含已在当前页）→ 刷新状态数量但保留筛选
watch(
  () => app.navTick,
  () => {
    if (!firstActivation && route.path === '/metadata') void refreshOnActive()
  }
)

/** 节流：onActivated 与 navTick 可能同帧触发，避免重复加载 */
async function refreshOnActive(): Promise<void> {
  const now = Date.now()
  if (now - lastRefreshTs < 400) return
  lastRefreshTs = now
  await app.loadDisplaySettings()
  if (pageSize.value !== app.pageSize) {
    pageSize.value = app.pageSize
    page.value = 1
  }
  await load()
  void meta.load()
}

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
      uncategorized: scopeMode.value === 'uncategorized',
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

function setScope(v: 'all' | 'local' | 'favorite' | 'hidden' | 'uncategorized'): void {
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
      <n-button size="small" type="error" secondary @click="openClearAll">
        <template #icon><n-icon><TrashOutline /></n-icon></template>
        清空全部数据
      </n-button>
      <n-button
        v-if="!batchMode"
        size="small"
        secondary
        title="点击进入多选（或长按某张封面 0.55 秒）"
        @click="startBatch"
      >
        多选
      </n-button>
      <n-button v-else size="small" type="warning" secondary @click="exitBatch">退出多选</n-button>
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
          <div
            v-for="v in items"
            :key="v.id"
            class="card"
            :class="{ selected: isSelected(v) }"
            :title="
              batchMode
                ? '单击 / 右键切换选中 · Esc 退出多选'
                : '左键封面或标题：编辑元数据 · 右键：关键帧概览 · 长按封面：进入多选'
            "
            @pointerdown="(e: PointerEvent) => onCardPointerDown(v, e)"
            @pointermove="onCardPointerMove"
            @pointerup="onCardPointerUp"
            @pointercancel="onCardPointerUp"
            @pointerleave="onCardPointerUp"
            @click="onCardRootClick(v, $event)"
            @contextmenu.prevent="onCardContextmenu(v)"
          >
            <div class="thumb-wrap sel-item" @click="onSelectAreaClick(v)">
              <ThumbImg :video-id="v.id" :thumbnail-path="v.thumbnailPath" />
              <span class="dur">{{ formatDuration(v.duration) }}</span>
              <span v-if="v.status === 'missing'" class="missing-tag">缺失</span>
              <button
                v-if="!batchMode"
                class="fav-btn no-batch"
                :class="{ active: v.isFavorite === 1 }"
                :title="v.isFavorite === 1 ? '取消收藏' : '收藏'"
                @click.stop="toggleFavorite(v)"
              >
                <n-icon :size="15"><Heart v-if="v.isFavorite === 1" /><HeartOutline v-else /></n-icon>
              </button>
            </div>
            <div class="card-title sel-item" :title="v.title" @click="onSelectAreaClick(v)">{{ v.title }}</div>
            <div class="card-meta">
              <span>{{ formatBytes(v.fileSize) }}</span>
              <span v-if="v.sha256">· {{ v.sha256.slice(0, 10) }}…</span>
            </div>
            <div v-if="!batchMode" class="card-actions no-batch">
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
          <div
            v-for="v in items"
            :key="v.id"
            class="list-item"
            :class="{ selected: isSelected(v) }"
            :title="
              batchMode
                ? '单击 / 右键切换选中 · Esc 退出多选'
                : '左键封面或标题：编辑元数据 · 右键：关键帧概览 · 长按封面：进入多选'
            "
            @pointerdown="(e: PointerEvent) => onCardPointerDown(v, e)"
            @pointermove="onCardPointerMove"
            @pointerup="onCardPointerUp"
            @pointercancel="onCardPointerUp"
            @pointerleave="onCardPointerUp"
            @click="onCardRootClick(v, $event)"
            @contextmenu.prevent="onCardContextmenu(v)"
          >
            <div class="list-thumb sel-item" @click="onSelectAreaClick(v)">
              <ThumbImg :video-id="v.id" :thumbnail-path="v.thumbnailPath" />
              <span v-if="v.status === 'missing'" class="missing-tag">缺失</span>
            </div>
            <div class="list-body sel-item" @click="onSelectAreaClick(v)">
              <div class="list-title">{{ v.title }}</div>
              <div class="list-meta">
                <span>{{ formatBytes(v.fileSize) }}</span>
                <span v-if="v.sha256" class="list-hash">· {{ v.sha256 }}</span>
              </div>
            </div>
            <button
              v-if="!batchMode"
              class="list-fav-btn no-batch"
              :class="{ active: v.isFavorite === 1 }"
              :title="v.isFavorite === 1 ? '取消收藏' : '收藏'"
              @click.stop="toggleFavorite(v)"
            >
              <n-icon :size="17"><Heart v-if="v.isFavorite === 1" /><HeartOutline v-else /></n-icon>
            </button>
            <div v-if="!batchMode" class="list-actions no-batch">
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

    <!-- 多选批量操作栏（粘底部） -->
    <div v-if="batchMode" class="batch-bar">
      <div class="batch-info">
        <span class="batch-count">已选 {{ selectedCount }} 条</span>
        <span class="muted-inline">单击 / 右键卡片切换选中 · Esc 退出</span>
      </div>
      <div class="batch-actions">
        <n-button size="small" quaternary @click="selectAllPage">全选本页</n-button>
        <n-button size="small" quaternary @click="clearSelection">清空选择</n-button>
        <span class="batch-sep" />
        <n-button size="small" :disabled="selectedCount === 0 || batchBusy" :loading="batchBusy" @click="doBatchFavorite(true)">收藏</n-button>
        <n-button size="small" :disabled="selectedCount === 0 || batchBusy" @click="doBatchFavorite(false)">取消收藏</n-button>
        <n-button size="small" :disabled="selectedCount === 0 || batchBusy" @click="openBatchEdit">分类 / 作者 / 标签 / 备注…</n-button>
        <n-button size="small" type="error" secondary :disabled="selectedCount === 0 || batchBusy" @click="openBatchDelete">删除…</n-button>
        <span class="batch-sep" />
        <n-button size="small" type="warning" secondary @click="exitBatch">退出</n-button>
      </div>
    </div>

    <!-- 编辑抽屉：保存后自动关闭并刷新列表 -->
    <MetaEditDrawer
      :video-id="editId"
      @close="editId = null"
      @updated="() => { editId = null; void load() }"
    />

    <!-- 右键：关键帧截图概览（点击图放大，再次点击关闭） -->
    <KeyframeDrawer
      :video="keyframeVideo"
      @close="closeKeyframes"
    />

    <!-- 批量删除确认 -->
    <n-modal
      :show="batchDeleteOpen"
      preset="card"
      style="width: 440px"
      title="批量删除所选记录？"
      @update:show="(v: boolean) => !v && (batchDeleteOpen = false)"
    >
      <p class="del-text">
        将移除选中的 <strong>{{ selectedCount }}</strong> 条视频记录、封面与关键帧元数据；缺失 / 占位记录自动降级为仅移除。
        <strong>「仅移除记录」不会删除任何本地文件</strong>。
      </p>
      <template #footer>
        <n-space justify="end">
          <n-button quaternary @click="batchDeleteOpen = false">取消</n-button>
          <n-button type="primary" :loading="batchBusy" @click="doBatchRemove(false)">仅移除记录</n-button>
          <n-button type="error" :loading="batchBusy" @click="doBatchRemove(true)">移除并删除文件</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 批量编辑元数据（分类 / 作者 / 追加标签 / 备注） -->
    <n-modal
      :show="batchEditOpen"
      preset="card"
      style="width: 500px"
      title="批量修改元数据"
      @update:show="(v: boolean) => !v && (batchEditOpen = false)"
    >
      <n-space vertical :size="14">
        <div class="batch-edit-row">
          <span class="batch-edit-label">分类</span>
          <n-select v-model:value="batchCat" :options="batchCatOptions" style="flex: 1" />
        </div>
        <div class="batch-edit-row">
          <span class="batch-edit-label">作者</span>
          <n-select v-model:value="batchAuthor" :options="batchAuthorOptions" style="flex: 1" />
        </div>
        <div class="batch-edit-row">
          <span class="batch-edit-label">追加标签</span>
          <n-select
            v-model:value="batchTags"
            multiple
            :options="batchTagOptions"
            placeholder="选择要追加的标签（仅已有标签）"
            style="flex: 1"
          />
        </div>
        <div class="batch-edit-row" style="align-items: flex-start">
          <span class="batch-edit-label">备注</span>
          <div style="flex: 1">
            <n-input v-model:value="batchRemark" type="textarea" :rows="2" placeholder="填写后覆盖所选记录的备注；不填保持原样" />
            <div style="margin-top: 6px">
              <n-checkbox v-model:checked="batchRemarkClear">清空所选记录的备注</n-checkbox>
            </div>
          </div>
        </div>
      </n-space>
      <template #footer>
        <n-space justify="end">
          <n-button quaternary @click="batchEditOpen = false">取消</n-button>
          <n-button type="primary" :loading="batchBusy" @click="applyBatchEdit">
            应用到 {{ selectedCount }} 条
          </n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 清空全部确认 -->
    <n-modal
      :show="clearAllOpen"
      preset="card"
      style="width: 440px"
      title="清空全部视频数据？"
      @update:show="(v: boolean) => !v && (clearAllOpen = false)"
    >
      <p class="del-text">
        将移除<strong>全部</strong>视频记录、缩略图与元数据（整个数据库共 {{ dbTotal }} 条，不受当前筛选影响），
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
          <n-button type="primary" :loading="deleting" @click="doRemove(false)">仅移除记录</n-button>
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
  /* 与视频库横屏封面模式一致：黑底、图片等比例居中，不裁剪 */
  background: #000;
  cursor: pointer;
}

.thumb-wrap :deep(.thumb) {
  object-fit: contain;
}

.thumb-wrap :deep(.thumb-placeholder) {
  color: rgba(255, 255, 255, 0.35);
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
  right: 8px;
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
  width: 128px;
  aspect-ratio: 16 / 9;
  flex-shrink: 0;
  border-radius: 8px;
  overflow: hidden;
  /* 与视频库横屏封面模式一致：黑底、图片等比例居中，不裁剪 */
  background: #000;
  cursor: pointer;
}

.list-thumb :deep(.thumb) {
  object-fit: contain;
}

.list-thumb :deep(.thumb-placeholder) {
  color: rgba(255, 255, 255, 0.35);
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

/* ---- 多选批量模式 ---- */
.card,
.list-item {
  position: relative;
  transition: border-color 0.15s, box-shadow 0.15s;
  cursor: default;
}

.card.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 1.5px var(--accent), var(--shadow-card);
}

.card.selected::after {
  content: '✓';
  position: absolute;
  right: 10px;
  top: 10px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 4;
  pointer-events: none;
}

.list-item.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.list-item.selected::after {
  content: '✓';
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.batch-bar {
  position: sticky;
  bottom: 0;
  z-index: 20;
  margin-top: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px 16px;
  border-radius: 12px;
  background: var(--bg-card);
  border: 1px solid var(--accent);
  box-shadow: 0 -6px 20px rgba(0, 0, 0, 0.25);
}

.batch-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.batch-count {
  font-size: 13px;
  font-weight: 700;
  color: var(--accent);
}

.batch-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.batch-sep {
  width: 1px;
  height: 18px;
  background: var(--border-strong);
  margin: 0 2px;
}

.batch-edit-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.batch-edit-label {
  width: 62px;
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
}

.muted-inline {
  color: var(--text-3);
  font-size: 12px;
}
</style>
