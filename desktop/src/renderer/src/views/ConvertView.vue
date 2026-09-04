<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import {
  NButton,
  NCard,
  NDataTable,
  NEmpty,
  NIcon,
  NInput,
  NRadio,
  NRadioGroup,
  NSelect,
  NSpace,
  NSwitch,
  NTag,
  useMessage,
  type DataTableColumns
} from 'naive-ui'
import {
  AddOutline,
  FolderOpenOutline,
  TrashOutline,
  FlashOutline
} from '@vicons/ionicons5'
import { formatBytes, formatDurationCN } from '../utils/format'
import type { ConvertFileInfo, ConvertFormat } from '../../../shared/types'

const message = useMessage()

const files = ref<ConvertFileInfo[]>([])
const inspecting = ref(false)

// 转换参数
const format = ref<ConvertFormat>('mp4')
const quality = ref<'high' | 'medium' | 'low'>('high')
const outputMode = ref<'default' | 'source'>('default')
const defaultOutputDir = ref('')
const deleteSource = ref(false)
const converting = ref(false)

const QUALITY_CRF: Record<string, number> = { high: 18, medium: 23, low: 28 }

const qualityOptions = [
  { label: '高画质（推荐）', value: 'high' },
  { label: '中等画质', value: 'medium' },
  { label: '低画质（小体积）', value: 'low' }
]

const formatOptions = [
  { label: 'MP4 (H.264 + AAC) — 兼容性最好', value: 'mp4' },
  { label: 'MKV (H.264 + AAC)', value: 'mkv' },
  { label: 'WebM (VP9 + Opus) — 体积小', value: 'webm' }
]

const columns: DataTableColumns<ConvertFileInfo> = [
  {
    title: '文件名',
    key: 'name',
    ellipsis: { tooltip: true }
  },
  {
    title: '时长',
    key: 'duration',
    width: 130,
    render: (row) => formatDurationCN(row.duration)
  },
  {
    title: '大小',
    key: 'size',
    width: 110,
    render: (row) => formatBytes(row.size)
  },
  {
    title: '格式',
    key: 'format',
    width: 80,
    render: (row) => (row.format ?? '--').toUpperCase()
  },
  {
    title: '',
    key: 'actions',
    width: 56,
    render: (row) =>
      h(
        NButton,
        {
          size: 'tiny',
          quaternary: true,
          type: 'error',
          onClick: () => removeFile(row.path)
        },
        { icon: () => h(NIcon, null, { default: () => h(TrashOutline) }) }
      )
  }
]

onMounted(async () => {
  defaultOutputDir.value = await window.api.getConvertOutputDir()
})

async function importFiles(): Promise<void> {
  const paths = await window.api.selectVideoFiles()
  if (paths && paths.length) {
    await addPaths(paths)
  }
}

async function importFolder(): Promise<void> {
  const folder = await window.api.selectFolder()
  if (!folder) return
  inspecting.value = true
  try {
    const paths = await window.api.collectFolderVideos(folder)
    if (paths.length === 0) {
      message.warning('该文件夹下没有视频文件')
      return
    }
    await addPaths(paths)
    message.success(`已从文件夹添加 ${paths.length} 个视频`)
  } finally {
    inspecting.value = false
  }
}

async function addPaths(paths: string[]): Promise<void> {
  inspecting.value = true
  try {
    const existing = new Set(files.value.map((f) => f.path.toLowerCase()))
    const fresh = paths.filter((p) => !existing.has(p.toLowerCase()))
    if (fresh.length === 0) {
      message.info('所选文件已在清单中')
      return
    }
    const infos = await window.api.inspectConvertFiles(fresh)
    files.value.push(...infos)
    message.success(`已添加 ${infos.length} 个文件`)
  } finally {
    inspecting.value = false
  }
}

function removeFile(path: string): void {
  files.value = files.value.filter((f) => f.path !== path)
}

function clearAll(): void {
  files.value = []
}

async function start(): Promise<void> {
  if (files.value.length === 0) {
    message.warning('请先导入要转换的视频文件')
    return
  }
  converting.value = true
  try {
    const count = await window.api.convertStart(
      files.value.map((f) => ({ path: f.path })),
      {
        format: format.value,
        crf: QUALITY_CRF[quality.value],
        scale: null,
        outputDir: outputMode.value === 'source' ? 'source' : defaultOutputDir.value || null,
        deleteSource: deleteSource.value
      }
    )
    message.success(`已加入转换队列：${count} 个任务，见「任务」页`)
  } finally {
    converting.value = false
  }
}

const totalSize = computed(() => files.value.reduce((s, f) => s + f.size, 0))
const totalDuration = computed(() => files.value.reduce((s, f) => s + (f.duration ?? 0), 0))
</script>

<template>
  <div class="page">
    <h2>转换</h2>
    <p class="muted">
      导入一个或多个视频文件（或整个文件夹），设置输出参数后加入转换队列。
      转换完成后的文件会自动加入视频库。进度见「任务」页。
    </p>

    <n-card size="small" style="margin-bottom: 16px">
      <n-space align="center" wrap>
        <n-button type="primary" :loading="inspecting" @click="importFiles">
          <template #icon>
            <n-icon><AddOutline /></n-icon>
          </template>
          导入文件
        </n-button>
        <n-button :loading="inspecting" @click="importFolder">
          <template #icon>
            <n-icon><FolderOpenOutline /></n-icon>
          </template>
          导入文件夹
        </n-button>
        <n-button v-if="files.length" quaternary type="error" @click="clearAll">清空清单</n-button>
        <template v-if="files.length">
          <n-tag size="small" type="info" :bordered="false">
            {{ files.length }} 个文件 · {{ formatDurationCN(totalDuration) }} · {{ formatBytes(totalSize) }}
          </n-tag>
        </template>
      </n-space>
    </n-card>

    <n-card size="small" style="margin-bottom: 16px" title="输出参数">
      <div class="params">
        <div class="param-row">
          <span class="param-label">输出格式</span>
          <n-select v-model:value="format" :options="formatOptions" style="width: 280px" />
        </div>
        <div class="param-row">
          <span class="param-label">画质</span>
          <n-radio-group v-model:value="quality">
            <n-radio v-for="q in qualityOptions" :key="q.value" :value="q.value" :label="q.label" />
          </n-radio-group>
        </div>
        <div class="param-row">
          <span class="param-label">导出位置</span>
          <n-radio-group v-model:value="outputMode">
            <n-radio value="default" label="默认导出目录" />
            <n-radio value="source" label="文件原目录" />
          </n-radio-group>
          <n-input
            v-if="outputMode === 'default'"
            v-model:value="defaultOutputDir"
            placeholder="默认导出目录（留空 = 源目录下 converted 文件夹）"
            style="width: 380px; margin-left: 12px"
          />
        </div>
        <div class="param-row">
          <span class="param-label">删除源文件</span>
          <n-switch v-model:value="deleteSource" />
          <span class="param-hint">转换成功后删除原文件</span>
        </div>
      </div>
    </n-card>

    <n-space style="margin-bottom: 12px">
      <n-button
        type="primary"
        :loading="converting"
        :disabled="files.length === 0"
        @click="start"
      >
        <template #icon>
          <n-icon><FlashOutline /></n-icon>
        </template>
        开始转换（{{ files.length }} 个文件）
      </n-button>
    </n-space>

    <n-data-table
      v-if="files.length"
      :columns="columns"
      :data="files"
      size="small"
      :max-height="380"
    />
    <n-empty
      v-else
      description="尚未导入文件。点击上方「导入文件」选择一个或多个视频，或「导入文件夹」批量添加"
      style="margin-top: 40px"
    />
  </div>
</template>

<style scoped>
.params {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.param-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.param-label {
  width: 84px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
  flex-shrink: 0;
}

.param-hint {
  font-size: 12px;
  color: var(--text-3);
}
</style>
