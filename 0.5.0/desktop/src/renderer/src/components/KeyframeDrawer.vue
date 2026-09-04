<script setup lang="ts">
import { ref, watch } from 'vue'
import { NDrawer, NDrawerContent, NEmpty, NIcon, NSpin, NTag } from 'naive-ui'
import { ImagesOutline } from '@vicons/ionicons5'
import type { KeyframeShot, VideoListItem } from '../../../shared/types'

const props = defineProps<{
  /** 打开时传入的目标视频；null = 关闭 */
  video: VideoListItem | null
}>()
const emit = defineEmits<{ close: [] }>()

/** 已加载成功的 data URL 集合 */
const loaded = ref<Map<string, string>>(new Map())
/** 全部加载完成（含失败项）后置 true */
const done = ref(false)
/** 当前放大查看的关键帧（null = 未放大） */
const zoomed = ref<KeyframeShot | null>(null)

watch(
  () => props.video,
  async (v) => {
    loaded.value = new Map()
    done.value = false
    zoomed.value = null
    if (!v) return
    for (const kf of v.keyframes) {
      try {
        const dataUrl = await window.api.getKeyframe(kf.name)
        if (dataUrl) {
          const m = new Map(loaded.value)
          m.set(kf.name, dataUrl)
          loaded.value = m
        }
      } catch {
        /* 单张失败跳过 */
      }
    }
    done.value = true
  },
  { immediate: true }
)

/** 时间位置换算：秒 → mm:ss 或 h:mm:ss（供标注截图所在时间） */
function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const p = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`
}

/** 点击缩略图放大；再次点击（或点遮罩）关闭 */
function toggleZoom(kf: KeyframeShot): void {
  if (zoomed.value?.name === kf.name) zoomed.value = null
  else zoomed.value = kf
}
</script>

<template>
  <n-drawer
    :show="!!video"
    :width="720"
    placement="right"
    @update:show="(v: boolean) => !v && emit('close')"
  >
    <n-drawer-content v-if="video" closable>
      <template #header>
        <div class="kf-header">
          <n-icon :size="18" style="margin-right: 8px"><ImagesOutline /></n-icon>
          <span class="kf-title">{{ video.title }}</span>
          <n-tag size="small" type="info" :bordered="false">{{ video.keyframes.length }} 张关键帧</n-tag>
        </div>
      </template>

      <!-- 顶部信息条：时长 / 总帧数 / 帧率 -->
      <div class="kf-info-bar">
        <div class="kf-info-item">
          <span class="kf-info-label">时长</span>
          <span class="kf-info-value">{{ video.duration != null ? formatClock(video.duration) : '未知' }}</span>
        </div>
        <div class="kf-info-item">
          <span class="kf-info-label">总帧数</span>
          <span class="kf-info-value">{{ video.frameCount != null ? `${video.frameCount} 帧` : '未知' }}</span>
        </div>
        <div class="kf-info-item">
          <span class="kf-info-label">帧率</span>
          <span class="kf-info-value">{{ video.fps != null ? `${video.fps} 帧/秒` : '未知' }}</span>
        </div>
        <span class="kf-info-hint">点击任意截图可放大查看，再次点击关闭</span>
      </div>

      <template v-if="video.keyframes.length">
        <n-spin :show="!done">
          <div class="kf-grid">
            <div v-for="(kf, i) in video.keyframes" :key="kf.name" class="kf-card" @click="toggleZoom(kf)">
              <div class="kf-img-wrap">
                <img
                  v-if="loaded.get(kf.name)"
                  :src="loaded.get(kf.name)"
                  class="kf-img"
                  :alt="kf.name"
                  loading="lazy"
                />
                <div v-else class="kf-img-empty">
                  <span class="muted">图片缺失</span>
                </div>
                <div v-if="zoomed?.name !== kf.name" class="kf-zoom-hint">点击放大</div>
              </div>
              <div class="kf-caption">
                <span class="kf-seq">#{{ String(i + 1).padStart(2, '0') }}</span>
                <span class="kf-meta">
                  <span v-if="video.fps && kf.frameNo" class="kf-frame">第 {{ kf.frameNo }} 帧</span>
                  <span class="kf-time">@ {{ formatClock(kf.timeSec) }}</span>
                </span>
              </div>
            </div>
          </div>
        </n-spin>
      </template>
      <n-empty v-else description="尚无关键帧截图 — 在导入页重新扫描该文件夹后自动生成" />
    </n-drawer-content>

    <!-- 放大查看遮罩：整抽屉内容被遮住时，点击图片或遮罩关闭 -->
    <div
      v-if="video && zoomed"
      class="kf-lightbox"
      @click="zoomed = null"
    >
      <img
        v-if="loaded.get(zoomed.name)"
        :src="loaded.get(zoomed.name)"
        class="kf-lightbox-img"
        :alt="zoomed.name"
      />
      <div class="kf-lightbox-caption" @click.stop>
        <span>{{ zoomed.name }}</span>
        <span class="kf-meta">
          <span v-if="video.fps && zoomed.frameNo" class="kf-frame">第 {{ zoomed.frameNo }} 帧</span>
          <span class="kf-time">@ {{ formatClock(zoomed.timeSec) }}</span>
        </span>
        <span class="kf-lightbox-close">点击任意处关闭</span>
      </div>
    </div>
  </n-drawer>
</template>

<style scoped>
.kf-header {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.kf-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 320px;
  margin-right: 8px;
}

/* 顶部统计信息条 */
.kf-info-bar {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  padding: 10px 14px;
  margin-bottom: 14px;
  border-radius: 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
}

.kf-info-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.kf-info-label {
  font-size: 12px;
  color: var(--text-3);
}

.kf-info-value {
  font-size: 14px;
  font-weight: 700;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.kf-info-hint {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-3);
}

.kf-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.kf-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  cursor: zoom-in;
  transition: border-color 0.15s, transform 0.12s;
}

.kf-card:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
}

.kf-img-wrap {
  aspect-ratio: 16 / 9;
  background: #000;
  position: relative;
}

.kf-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.kf-img-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
  font-size: 12px;
}

.kf-zoom-hint {
  position: absolute;
  right: 6px;
  bottom: 6px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.75);
  background: rgba(0, 0, 0, 0.45);
  padding: 2px 8px;
  border-radius: 8px;
  opacity: 0;
  transition: opacity 0.15s;
  pointer-events: none;
}

.kf-card:hover .kf-zoom-hint {
  opacity: 1;
}

.kf-caption {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
}

.kf-seq {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12px;
  color: var(--accent);
  font-weight: 700;
}

.kf-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}

.muted {
  color: var(--text-3);
}

/* 放大遮罩 */
.kf-lightbox {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(0, 0, 0, 0.88);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  cursor: zoom-out;
  padding: 40px;
}

.kf-lightbox-img {
  max-width: 92%;
  max-height: 84vh;
  object-fit: contain;
  border-radius: 6px;
  box-shadow: 0 10px 50px rgba(0, 0, 0, 0.6);
}

.kf-lightbox-caption {
  margin-top: 14px;
  display: flex;
  align-items: center;
  gap: 16px;
  color: rgba(255, 255, 255, 0.85);
  font-size: 13px;
}

.kf-lightbox-caption .kf-meta {
  color: rgba(255, 255, 255, 0.7);
}

.kf-lightbox-close {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
}
</style>
