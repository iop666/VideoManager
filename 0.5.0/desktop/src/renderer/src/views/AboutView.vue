<script setup lang="ts">
import { onMounted } from 'vue'
import {
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NEmpty,
  NIcon,
  NSpace,
  NSpin,
  useMessage
} from 'naive-ui'
import { OpenOutline } from '@vicons/ionicons5'
import { useAppStore } from '../stores/app'
import appIcon from '../assets/app-icon.png'

const store = useAppStore()
const message = useMessage()

onMounted(async () => {
  await store.loadInfo()
})

/** 在系统浏览器打开 GitHub 主页 */
async function openGithub(): Promise<void> {
  const res = await window.api.openExternal('https://github.com/iop666/VideoManager')
  if (!res.ok) message.error(res.error ?? '打开失败')
}
</script>

<template>
  <div class="page">
    <h2>关于</h2>

    <!-- 软件版本（单开一块） -->
    <n-card size="small" style="max-width: 720px">
      <n-spin :show="store.loading">
        <div v-if="store.info" class="about-version">
          <img :src="appIcon" class="app-icon-img" alt="VideoManager" />
          <div>
            <div class="app-name">VideoManager</div>
            <div class="version-line">
              <span class="version-label">软件版本</span>
              <span class="version-no">v{{ store.info.version }}</span>
            </div>
          </div>
        </div>
        <n-empty v-else description="未加载到应用信息" />
      </n-spin>
    </n-card>

    <!-- 运行环境 -->
    <n-card title="运行环境" size="small" style="max-width: 720px; margin-top: 16px">
      <n-spin :show="store.loading">
        <n-descriptions
          v-if="store.info"
          :column="1"
          label-placement="left"
          bordered
          size="small"
        >
          <n-descriptions-item label="Electron">
            {{ store.info.versions.electron }}
          </n-descriptions-item>
          <n-descriptions-item label="Node.js">
            {{ store.info.versions.node }}
          </n-descriptions-item>
          <n-descriptions-item label="Chromium">
            {{ store.info.versions.chrome }}
          </n-descriptions-item>
          <n-descriptions-item label="数据库路径">
            {{ store.info.dbPath }}
          </n-descriptions-item>
          <n-descriptions-item label="ffprobe">
            {{ store.info.ffmpeg.ffprobe ?? '未找到' }}
          </n-descriptions-item>
          <n-descriptions-item label="ffmpeg">
            {{ store.info.ffmpeg.ffmpeg ?? '未找到' }}
          </n-descriptions-item>
          <n-descriptions-item v-if="store.info.ffmpeg.error" label="ffmpeg 错误">
            {{ store.info.ffmpeg.error }}
          </n-descriptions-item>
        </n-descriptions>
        <n-empty v-else description="未加载到应用信息" />
      </n-spin>
    </n-card>

    <n-card title="GitHub 地址" size="small" style="max-width: 720px; margin-top: 16px">
      <n-space vertical>
        <span style="font-size: 13px; color: var(--text-2)">VideoManager · 本地视频管理与安卓端同步工具</span>
        <div class="about-github">
          <span class="appearance-label" style="width: auto">GitHub</span>
          <a
            class="about-link"
            href="https://github.com/iop666/VideoManager"
            target="_blank"
            rel="noopener noreferrer"
            @click.prevent="openGithub"
          >https://github.com/iop666/VideoManager</a>
          <n-button size="tiny" tertiary type="primary" @click="openGithub">
            <template #icon>
              <n-icon><OpenOutline /></n-icon>
            </template>
            打开
          </n-button>
        </div>
      </n-space>
    </n-card>
  </div>
</template>

<style scoped>
.about-version {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 10px 4px;
}

.app-icon-img {
  width: 56px;
  height: 56px;
  border-radius: 12px;
  object-fit: cover;
  flex-shrink: 0;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
}

.app-name {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-1);
}

.version-line {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 2px;
}

.version-label {
  font-size: 12px;
  color: var(--text-3);
}

.version-no {
  font-size: 14px;
  font-weight: 600;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.3px;
}

.about-github {
  display: flex;
  align-items: center;
  gap: 12px;
}

.about-link {
  font-size: 13px;
  color: var(--accent);
  text-decoration: none;
  word-break: break-all;
}

.about-link:hover {
  text-decoration: underline;
}

.appearance-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
  flex-shrink: 0;
}
</style>
