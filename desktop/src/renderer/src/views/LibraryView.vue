<script setup lang="ts">
defineOptions({ name: 'LibraryView' })
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  NEmpty,
  NIcon,
  NInput,
  NPagination,
  NSelect,
  NSpin,
  NTag,
  useMessage
} from 'naive-ui'
import {
  GridOutline,
  Heart,
  ListOutline,
  SearchOutline,
  PlayOutline
} from '@vicons/ionicons5'
import { useAppStore } from '../stores/app'
import { useLibraryStore } from '../stores/library'
import { useMetaStore } from '../stores/meta'
import { formatBytes, formatDuration } from '../utils/format'
import VideoDetailDrawer from '../components/VideoDetailDrawer.vue'
import KeyframeDrawer from '../components/KeyframeDrawer.vue'
import ThumbImg from '../components/ThumbImg.vue'
import type { Orientation, SortDir, SortField, VideoListItem } from '../../../shared/types'

const app = useAppStore()
const library = useLibraryStore()
const meta = useMetaStore()
const route = useRoute()
const message = useMessage()

/** 缩略图点击：直接调用 PotPlayer 播放（记录播放次数） */
const playingId = ref<number | null>(null)
async function playWithPlayer(v: VideoListItem): Promise<void> {
  if (v.status === 'missing') {
    message.warning('文件已缺失，无法播放')
    return
  }
  playingId.value = v.id
  try {
    await window.api.recordPlay(v.id)
    const res = await window.api.playWithPotPlayer(v.filePath)
    if (res.ok) {
      message.success('已调用 PotPlayer 播放')
      void library.refreshItem(v.id)
    } else {
      message.error(res.error ?? '播放失败')
    }
  } finally {
    playingId.value = null
  }
}

const viewMode = ref<'grid' | 'list'>(
  (localStorage.getItem('vm-view-mode') as 'grid' | 'list') || 'grid'
)

/** 右键打开关键帧截图概览 */
const keyframeVideo = ref<VideoListItem | null>(null)
function openKeyframes(v: VideoListItem): void {
  keyframeVideo.value = v
}
function closeKeyframes(): void {
  keyframeVideo.value = null
}

/** 封面显示模式：从设置实时同步（设置页修改后无需重启即生效） */
const coverMode = computed<'landscape' | 'normal'>(() => app.coverMode)
const isLandscapeCover = computed(() => coverMode.value === 'landscape')

function setViewMode(mode: 'grid' | 'list'): void {
  viewMode.value = mode
  localStorage.setItem('vm-view-mode', mode)
}

/** 首次激活后，每次进入本页：同步最新每页数量/封面模式并刷新列表（保留筛选条件） */
let firstActivation = true
let lastRefreshTs = 0
onActivated(() => {
  if (firstActivation) {
    firstActivation = false
    return
  }
  void refreshOnActive()
})

// 点击左侧导航「视频库」（含已在当前页）→ 刷新状态数量但保留筛选
watch(
  () => app.navTick,
  () => {
    if (!firstActivation && route.path === '/library') void refreshOnActive()
  }
)

/** 节流：onActivated 与 navTick 可能同帧触发，避免重复加载 */
async function refreshOnActive(): Promise<void> {
  const now = Date.now()
  if (now - lastRefreshTs < 400) return
  lastRefreshTs = now
  await app.loadDisplaySettings()
  if (library.query.pageSize !== app.pageSize) {
    library.query.pageSize = app.pageSize
    library.query.page = 1
  }
  await library.load()
  void meta.load()
}

onMounted(async () => {
  await app.loadDisplaySettings()
  void meta.load()
  library.query.pageSize = app.pageSize
  // 应用路由筛选（统计页跳转：分类/标签/方向）
  const q = route.query
  if (q.categoryId) library.query.categoryId = Number(q.categoryId)
  if (q.tagId) library.query.tagId = Number(q.tagId)
  if (q.authorId) library.query.authorId = Number(q.authorId)
  if (q.orientation) library.query.orientation = q.orientation as Orientation
  // 同步初始范围（默认「全部」= 含缺失文件）
  library.query.includeMissing = scopeMode.value === 'all'
  await library.load()
})

// 统计页跳转（带查询参数）时应用新筛选；纯导航（无参数）不重置用户筛选
watch(
  () => JSON.stringify(route.query),
  () => {
    const q = route.query
    if (Object.keys(q).length === 0) return
    if (q.categoryId) library.query.categoryId = Number(q.categoryId)
    if (q.tagId) library.query.tagId = Number(q.tagId)
    if (q.authorId) library.query.authorId = Number(q.authorId)
    if (q.orientation) library.query.orientation = q.orientation as Orientation
    library.query.page = 1
    void library.load()
  }
)

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

/** 标签名 → 颜色 映射 */
const tagColorMap = computed(() => new Map(meta.tags.map((t) => [t.name, t.color])))

function tagColor(name: string): string | undefined {
  return tagColorMap.value.get(name) ?? undefined
}

/** 作者名 → 颜色 映射 */
const authorColorMap = computed(() => new Map(meta.authors.map((a) => [a.name, a.color])))

function authorColor(name: string): string | undefined {
  return authorColorMap.value.get(name) ?? undefined
}

function handleSearch(value: string): void {
  library.setSearch(value)
}

function setAuthor(v: number | null): void {
  library.query.authorId = v
  library.query.page = 1
  void library.load()
}

function setOrientation(v: Orientation | null): void {
  library.query.orientation = v
  library.query.page = 1
  void library.load()
}

/** 范围：全部 / 仅显示本地 / 仅显示收藏（默认全部） */
const scopeMode = ref<'all' | 'local' | 'favorite'>('all')

const scopeOptions = [
  { label: '全部', value: 'all' },
  { label: '仅显示本地', value: 'local' },
  { label: '仅显示收藏', value: 'favorite' }
]

function setScope(v: 'all' | 'local' | 'favorite'): void {
  scopeMode.value = v
  library.query.favorite = v === 'favorite'
  library.query.includeMissing = v === 'all'
  library.query.page = 1
  void library.load()
}

/** 简要分辨率：1920×1080 或 1080p */
function resText(v: VideoListItem): string {
  if (!v.width || !v.height) return ''
  return `${v.width}×${v.height}`
}

const fullMeta = ref(false)
</script>

<template>
  <div class="page library-page">
    <!-- 第一行：筛选选项 + 视图切换 -->
    <div class="toolbar">
      <n-select
        :value="scopeMode"
        :options="scopeOptions"
        style="width: 130px"
        @update:value="setScope"
      />
      <n-select
        :value="library.query.categoryId"
        :options="categoryOptions"
        placeholder="全部分类"
        clearable
        style="width: 150px"
        @update:value="library.setCategory"
      />
      <n-select
        :value="library.query.tagId"
        :options="tagOptions"
        placeholder="全部标签"
        clearable
        style="width: 150px"
        @update:value="library.setTag"
      />
      <n-select
        :value="library.query.authorId"
        :options="authorOptions"
        placeholder="全部作者"
        clearable
        style="width: 150px"
        @update:value="setAuthor"
      />
      <n-select
        :value="library.query.orientation"
        :options="orientationOptions"
        placeholder="全部方向"
        clearable
        style="width: 110px"
        @update:value="setOrientation"
      />
      <n-select
        :value="library.query.sortBy"
        :options="sortOptions"
        style="width: 110px"
        @update:value="(v: SortField) => library.setSort(v, library.query.sortDir ?? 'desc')"
      />
      <n-select
        :value="library.query.sortDir"
        :options="dirOptions"
        style="width: 84px"
        @update:value="(v: SortDir) => library.setSort(library.query.sortBy ?? 'date_added', v)"
      />
      <div class="spacer" />
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
      <n-input
        :value="library.query.search"
        clearable
        placeholder="搜索标题 / 文件名..."
        style="width: 240px"
        @update:value="handleSearch"
      >
        <template #prefix>
          <n-icon><SearchOutline /></n-icon>
        </template>
      </n-input>
    </div>

    <div class="count-line">
      共 {{ library.total }} 个视频
    </div>

    <n-spin :show="library.loading">
      <template v-if="library.items.length">
        <!-- 网格视图 -->
        <div v-if="viewMode === 'grid'" class="grid">
          <div
            v-for="v in library.items"
            :key="v.id"
            class="card"
            :title="'左键：视频详情 · 右键：关键帧截图概览'"
            @contextmenu.prevent="openKeyframes(v)"
          >
            <div
              class="thumb-wrap"
              :class="{ 'thumb-landscape': isLandscapeCover, 'thumb-normal': !isLandscapeCover }"
              @click="playWithPlayer(v)"
            >
              <ThumbImg :video-id="v.id" :thumbnail-path="v.thumbnailPath" />
              <span class="dur">{{ formatDuration(v.duration) }}</span>
              <span v-if="v.isFavorite" class="fav">
                <n-icon :size="14"><Heart /></n-icon>
              </span>
              <span class="play-hint" :class="{ spinning: playingId === v.id }">
                <n-icon :size="18"><PlayOutline /></n-icon>
              </span>
            </div>
            <div class="card-title" :title="v.title" @click="library.openDetail(v.id)">{{ v.title }}</div>
            <div class="card-meta" @click="library.openDetail(v.id)">
              <span v-if="v.format">{{ v.format.toUpperCase() }}</span>
              <span>·</span>
              <span>{{ formatBytes(v.fileSize) }}</span>
              <span v-if="resText(v)">· {{ resText(v) }}</span>
            </div>
            <div class="card-tags" @click="library.openDetail(v.id)">
              <n-tag
                v-if="v.author"
                size="tiny"
                :bordered="false"
                class="author-tag"
                :color="authorColor(v.author) ? { color: authorColor(v.author)!, textColor: '#fff' } : undefined"
              >
                {{ v.author }}
              </n-tag>
              <n-tag
                v-for="t in v.tags.slice(0, 3)"
                :key="t"
                size="tiny"
                :bordered="false"
                :color="tagColor(t) ? { color: tagColor(t)!, textColor: '#fff' } : undefined"
              >
                {{ t }}
              </n-tag>
            </div>
          </div>
        </div>
        <!-- 列表视图：缩略图 + 名称 + 大小/时长/分辨率 -->
        <div v-else class="list">
          <div
            v-for="v in library.items"
            :key="v.id"
            class="list-item"
            :title="'左键：视频详情 · 右键：关键帧截图概览'"
            @contextmenu.prevent="openKeyframes(v)"
          >
            <div class="list-thumb" @click="playWithPlayer(v)">
              <ThumbImg :video-id="v.id" :thumbnail-path="v.thumbnailPath" />
              <span class="dur">{{ formatDuration(v.duration) }}</span>
              <span class="play-hint" :class="{ spinning: playingId === v.id }">
                <n-icon :size="16"><PlayOutline /></n-icon>
              </span>
            </div>
            <div class="list-body" @click="library.openDetail(v.id)">
              <div class="list-title" :title="v.title">{{ v.title }}</div>
              <div class="list-meta">
                <span>{{ formatBytes(v.fileSize) }}</span>
                <span v-if="resText(v)">· {{ resText(v) }}</span>
                <span v-if="v.format">· {{ v.format.toUpperCase() }}</span>
                <span v-if="v.author">· {{ v.author }}</span>
                <span v-if="fullMeta && v.sha256" class="list-hash">· {{ v.sha256.slice(0, 14) }}…</span>
              </div>
            </div>
            <div class="list-tags" @click="library.openDetail(v.id)">
              <n-tag v-for="t in v.tags.slice(0, 3)" :key="t" size="tiny" :bordered="false">
                {{ t }}
              </n-tag>
            </div>
            <div v-if="v.isFavorite" class="list-fav">
              <n-icon :size="14"><Heart /></n-icon>
            </div>
          </div>
        </div>
      </template>
      <n-empty v-else description="没有匹配的视频。先到「导入」页添加文件夹并扫描" style="margin-top: 48px" />
    </n-spin>

    <div class="pager">
      <n-pagination
        :page="library.query.page"
        :item-count="library.total"
        :page-size="library.query.pageSize"
        :page-slot="7"
        show-quick-jumper
        @update:page="library.setPage"
      />
    </div>

    <VideoDetailDrawer
      :video-id="library.detailVideoId"
      @close="library.closeDetail"
    />

    <KeyframeDrawer
      :video="keyframeVideo"
      @close="closeKeyframes"
    />
  </div>
</template>

<style scoped>
.library-page {
  max-width: none;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.spacer {
  flex: 1;
}

.search-row {
  display: flex;
  justify-content: flex-end;
  margin: 12px 0 8px;
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
  transition: background 0.15s, color 0.15s;
}

.view-btn:hover {
  color: var(--text-1);
}

.view-btn.active {
  background: var(--accent-soft);
  color: var(--accent);
}

/* 列表视图 */
.list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.list-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-card);
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.list-item:hover {
  border-color: var(--accent);
  box-shadow:
    0 0 0 1px var(--accent),
    var(--shadow-hover);
}

.list-thumb {
  position: relative;
  width: 120px;
  height: 68px;
  flex-shrink: 0;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-hover);
}

.list-body {
  flex: 1;
  min-width: 0;
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
  font-size: 12px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.list-tags {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.list-hash {
  font-family: 'JetBrains Mono', Consolas, monospace;
}

.list-fav {
  color: #ff5c7a;
  flex-shrink: 0;
}

.count-line {
  color: var(--text-3);
  font-size: 12px;
  margin: 10px 0 14px;
  font-variant-numeric: tabular-nums;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
}

.card {
  cursor: pointer;
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg-card);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-card);
  transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s;
  display: flex;
  flex-direction: column;
}

.card:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
  box-shadow:
    0 0 0 1px var(--accent),
    var(--shadow-hover);
}

.thumb-wrap {
  position: relative;
  aspect-ratio: 16 / 9;
  background: var(--bg-hover);
  overflow: hidden;
}

/* 横屏比例（默认）：封面等比例居中缩放到 16:9 框内，两侧多余空白显示黑色 */
.thumb-landscape {
  background: #000;
  aspect-ratio: 16 / 9;
}

.thumb-landscape :deep(.thumb) {
  object-fit: contain;
}

/* 正常比例：高度不限，封面铺满 */
.thumb-normal {
  aspect-ratio: auto;
  background: var(--bg-hover);
}

.thumb-normal :deep(.thumb) {
  object-fit: cover;
}

.thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.thumb-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-disabled);
}

.dur {
  position: absolute;
  right: 8px;
  bottom: 8px;
  /* 固定白字 + 半透明黑底，避免亮色主题下黑字黑底 */
  background: rgba(0, 0, 0, 0.65);
  color: #ffffff;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 6px;
  font-variant-numeric: tabular-nums;
  backdrop-filter: blur(4px);
}

.fav {
  position: absolute;
  left: 8px;
  top: 8px;
  color: #ff5c7a;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
}

/* 缩略图中央播放按钮（hover 显示，点击直接调 PotPlayer） */
.play-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: rgba(0, 0, 0, 0.25);
  opacity: 0;
  transition: opacity 0.18s;
}

.thumb-wrap:hover .play-hint,
.list-thumb:hover .play-hint,
.play-hint.spinning {
  opacity: 1;
}

.play-hint.spinning {
  animation: play-pulse 1.1s ease-in-out infinite;
}

@keyframes play-pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.15);
  }
}

.card-title {
  font-size: 13px;
  font-weight: 600;
  padding: 10px 12px 2px;
  color: var(--text-1);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  flex: 1;
  align-content: start;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px 6px;
  font-size: 10px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
}

.rating {
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.card-tags {
  display: flex;
  gap: 3px;
  padding: 0 10px 8px;
  flex-wrap: wrap;
}

.card-tags :deep(.n-tag) {
  font-size: 10px;
  padding: 0 6px;
  height: 18px;
  line-height: 1;
}

.author-tag {
  font-weight: 600;
}

.pager {
  display: flex;
  justify-content: center;
  margin-top: 20px;
}
</style>
