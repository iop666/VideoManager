<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  NDescriptions,
  NDescriptionsItem,
  NDrawer,
  NDrawerContent,
  NIcon,
  NSpin,
  NSpace,
  NTag,
  useMessage
} from 'naive-ui'
import { PlayOutline } from '@vicons/ionicons5'
import { useLibraryStore } from '../stores/library'
import { useMetaStore } from '../stores/meta'
import { formatBytes, formatDuration } from '../utils/format'
import ThumbImg from './ThumbImg.vue'
import type { VideoListItem } from '../../../shared/types'

const props = defineProps<{ videoId: number | null }>()
const emit = defineEmits<{ close: [] }>()

const library = useLibraryStore()
const meta = useMetaStore()
const message = useMessage()

const video = ref<VideoListItem | null>(null)
const loading = ref(false)
const playing = ref(false)

watch(
  () => props.videoId,
  (id) => {
    if (id) void load(id)
  },
  { immediate: true }
)

async function load(id: number): Promise<void> {
  loading.value = true
  try {
    video.value = await window.api.getVideo(id)
  } finally {
    loading.value = false
  }
}

async function play(): Promise<void> {
  if (!video.value) return
  playing.value = true
  try {
    // 播放计数 +1（本次播放）
    await window.api.recordPlay(video.value.id)
    const res = await window.api.playWithPotPlayer(video.value.filePath)
    if (res.ok) {
      message.success('已调用 PotPlayer 播放')
      await load(video.value.id)
      void library.refreshItem(video.value.id)
    } else {
      message.error(res.error ?? '播放失败')
    }
  } finally {
    playing.value = false
  }
}

// 只读展示的颜色（分类/作者/标签，来自统计页设置）
const categoryMeta = computed(() =>
  meta.categories.find((c) => c.id === video.value?.categoryId)
)
const authorMeta = computed(() => meta.authors.find((a) => a.id === video.value?.authorId))
const tagMetas = computed(() => {
  const map = new Map(meta.tags.map((t) => [t.name, t]))
  return (video.value?.tags ?? []).map((name) => map.get(name))
})
</script>

<template>
  <n-drawer :show="videoId !== null" :width="540" @update:show="(v: boolean) => !v && emit('close')">
    <n-drawer-content
      title="视频详情"
      closable
      :native-scrollbar="false"
    >
      <n-spin :show="loading">
        <template v-if="video">
          <div class="detail-thumb" @click="play">
            <ThumbImg :video-id="video.id" :thumbnail-path="video.thumbnailPath" />
            <div class="play-overlay" :class="{ spinning: playing }">
              <n-icon :size="40"><PlayOutline /></n-icon>
            </div>
          </div>

          <div class="file-name-block" style="margin-top: 14px">
            <span class="wrap-text file-name">{{ video.fileName }}</span>
            <div v-if="video.sha256" class="sha256-line">
              SHA-256：{{ video.sha256 }}
            </div>
          </div>

          <!-- 元数据展示（分类/作者/评分/标签等，只读；编辑请到「元数据」页） -->
          <div class="meta-block">
            <div class="meta-row">
              <span class="meta-row-label">分类</span>
              <n-tag
                v-if="categoryMeta"
                :bordered="false"
                :color="{ color: categoryMeta.color ?? '#888', textColor: '#fff' }"
              >
                {{ categoryMeta.name }}
              </n-tag>
              <span v-else class="meta-empty">未设置</span>
            </div>
            <div class="meta-row">
              <span class="meta-row-label">作者</span>
              <n-tag
                v-if="authorMeta"
                :bordered="false"
                :color="{ color: authorMeta.color ?? '#888', textColor: '#fff' }"
              >
                {{ authorMeta.name }}
              </n-tag>
              <span v-else class="meta-empty">未设置</span>
            </div>
            <div class="meta-row">
              <span class="meta-row-label">评分</span>
              <span v-if="video.rating" class="rating-text">{{ video.rating.toFixed(1) }} / 10</span>
              <span v-else class="meta-empty">未评分</span>
            </div>
            <div class="meta-row">
              <span class="meta-row-label">标签</span>
              <n-space v-if="tagMetas.length" :size="6" wrap>
                <n-tag
                  v-for="t in tagMetas"
                  :key="t?.name ?? ''"
                  :bordered="false"
                  :color="{ color: t?.color ?? '#555', textColor: '#fff' }"
                >
                  {{ t?.name }}
                </n-tag>
              </n-space>
              <span v-else class="meta-empty">无标签</span>
            </div>
            <div class="meta-row">
              <span class="meta-row-label">收藏</span>
              <span :class="video.isFavorite ? 'fav-text' : 'meta-empty'">
                {{ video.isFavorite ? '已收藏' : '未收藏' }}
              </span>
            </div>
            <div v-if="video.remark" class="meta-row">
              <span class="meta-row-label">备注</span>
              <span class="remark-text">{{ video.remark }}</span>
            </div>
          </div>

          <n-descriptions :column="2" size="small" label-placement="left" style="margin-top: 14px">
            <n-descriptions-item label="大小">{{ formatBytes(video.fileSize) }}</n-descriptions-item>
            <n-descriptions-item label="时长">{{ formatDuration(video.duration) }}</n-descriptions-item>
            <n-descriptions-item label="分辨率">
              {{ video.width && video.height ? `${video.width}×${video.height}` : '--' }}
            </n-descriptions-item>
            <n-descriptions-item label="编码">{{ video.codec ?? '--' }}</n-descriptions-item>
            <n-descriptions-item label="格式">{{ (video.format ?? '--').toUpperCase() }}</n-descriptions-item>
            <n-descriptions-item label="状态">{{ video.status === 'missing' ? '文件缺失' : '正常' }}</n-descriptions-item>
            <n-descriptions-item label="播放次数">{{ video.playCount }}</n-descriptions-item>
            <n-descriptions-item label="加入时间">{{ video.dateAdded }}</n-descriptions-item>
            <n-descriptions-item label="路径" :span="2">
              <span class="wrap-text path">{{ video.filePath }}</span>
            </n-descriptions-item>
          </n-descriptions>

          <div class="readonly-hint">
            元数据编辑请前往「元数据」页（视频库为只读浏览）
          </div>
        </template>
      </n-spin>
    </n-drawer-content>
  </n-drawer>
</template>

<style scoped>
.detail-thumb {
  position: relative;
  height: 240px;
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg-hover);
  cursor: pointer;
}

.play-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  opacity: 0;
  transition: opacity 0.2s;
}

.detail-thumb:hover .play-overlay,
.play-overlay.spinning {
  opacity: 1;
}

.play-overlay.spinning {
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.08);
  }
}

.wrap-text {
  word-break: break-all;
  white-space: normal;
  line-height: 1.5;
}

.file-name {
  font-weight: 700;
  color: var(--accent);
  font-size: 18px;
  line-height: 1.4;
}

.sha256-line {
  margin-top: 6px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  color: var(--text-3);
  word-break: break-all;
}

.meta-block {
  margin-top: 18px;
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

.meta-row-label {
  width: 44px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
  flex-shrink: 0;
}

.meta-empty {
  font-size: 12px;
  color: var(--text-3);
}

.rating-text {
  font-size: 13px;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.fav-text {
  font-size: 13px;
  color: #ff5c7a;
  font-weight: 600;
}

.remark-text {
  font-size: 13px;
  color: var(--text-1);
  word-break: break-all;
}

.readonly-hint {
  margin-top: 14px;
  font-size: 12px;
  color: var(--text-3);
}
</style>
