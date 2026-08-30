<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NEmpty,
  NForm,
  NFormItem,
  NIcon,
  NInput,
  NSpace,
  NTag,
  useMessage,
  type DataTableColumns
} from 'naive-ui'
import { AddOutline, FolderOpenOutline, RefreshOutline } from '@vicons/ionicons5'
import { useRenameStore } from '../stores/rename'
import type { RenamePreviewItem } from '../../../shared/types'

const message = useMessage()
const rename = useRenameStore()

interface RenameFile {
  path: string
  name: string
}

const files = ref<RenameFile[]>([])
const selectedPaths = ref<string[]>([])
const loading = ref(false)

const columns: DataTableColumns<RenameFile> = [
  { type: 'selection' },
  { title: '文件名', key: 'name', ellipsis: { tooltip: true } }
]

const previewColumns: DataTableColumns<RenamePreviewItem> = [
  { title: '原文件名', key: 'oldName', ellipsis: { tooltip: true } },
  { title: '新文件名', key: 'newName', ellipsis: { tooltip: true } },
  {
    title: '状态',
    key: 'status',
    width: 90,
    render: (row) => {
      if (row.conflict) return h(NTag, { type: 'error', size: 'small' }, { default: () => '冲突' })
      if (row.unchanged) return h(NTag, { type: 'default', size: 'small' }, { default: () => '不变' })
      return h(NTag, { type: 'success', size: 'small' }, { default: () => '重命名' })
    }
  }
]

onMounted(() => {
  void rename.refreshUndo()
})

async function importFiles(): Promise<void> {
  const paths = await window.api.selectVideoFiles()
  if (paths && paths.length) addPaths(paths)
}

async function importFolder(): Promise<void> {
  const folder = await window.api.selectFolder()
  if (!folder) return
  loading.value = true
  try {
    const paths = await window.api.collectFolderVideos(folder)
    if (paths.length === 0) {
      message.warning('该文件夹下没有视频文件')
      return
    }
    addPaths(paths)
    message.success(`已从文件夹添加 ${paths.length} 个视频`)
  } finally {
    loading.value = false
  }
}

function addPaths(paths: string[]): void {
  const existing = new Set(files.value.map((f) => f.path.toLowerCase()))
  const fresh = paths.filter((p) => !existing.has(p.toLowerCase()))
  if (fresh.length === 0) {
    message.info('所选文件已在清单中')
    return
  }
  const added = fresh.map((p) => {
    const name = p.split(/[\\/]/).pop() ?? p
    return { path: p, name }
  })
  files.value.push(...added)
  // 默认全选
  selectedPaths.value = files.value.map((f) => f.path)
  message.success(`已添加 ${added.length} 个文件（默认全选）`)
}

function clearAll(): void {
  files.value = []
  selectedPaths.value = []
  rename.reset()
}

function selectAll(checked: boolean): void {
  selectedPaths.value = checked ? files.value.map((f) => f.path) : []
}

const selectedFiles = computed(() =>
  files.value.filter((f) => selectedPaths.value.includes(f.path))
)

async function preview(): Promise<void> {
  const targets = selectedFiles.value.map((f) => ({ filePath: f.path, title: f.name }))
  if (targets.length === 0) {
    message.warning('请先选择要重命名的文件')
    return
  }
  try {
    await rename.buildPreview(targets)
    if (rename.preview.length === 0) {
      message.warning('生成预览失败，请检查规则')
    }
  } catch (err) {
    message.error(`生成预览失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

/** 取消预览（清空表格，回到规则编辑状态） */
function cancelPreview(): void {
  rename.reset()
}

async function apply(): Promise<void> {
  if (selectedFiles.value.length === 0) {
    message.warning('请先选择要重命名的文件')
    return
  }
  // 始终用当前规则重新生成预览，避免旧预览导致新前缀/后缀不生效
  try {
    await rename.buildPreview(selectedFiles.value.map((f) => ({ filePath: f.path, title: f.name })))
  } catch (err) {
    message.error(`生成预览失败：${err instanceof Error ? err.message : String(err)}`)
    return
  }
  if (rename.preview.length === 0) return
  const changed = rename.preview.filter((p) => !p.conflict && !p.unchanged).length
  if (changed === 0) {
    message.warning('没有可重命名的项目（前缀/后缀为空或文件名无变化）')
    return
  }
  try {
    await rename.apply()
  } catch (err) {
    message.error(`执行失败：${err instanceof Error ? err.message : String(err)}`)
    return
  }
  const r = rename.result
  if (r && r.failed.length > 0) {
    message.error(`有 ${r.failed.length} 个文件重命名失败：${r.failed[0].error}`)
  }
  message.success(`已重命名 ${r?.renamed ?? 0} 个文件`)
  // 刷新清单名称
  const byPath = new Map<string, string>()
  for (const p of rename.preview) byPath.set(p.oldPath, p.newName)
  files.value = files.value.map((f) => ({ ...f, name: byPath.get(f.path) ?? f.name }))
  rename.reset()
}

async function undo(): Promise<void> {
  await rename.undo()
  message.success(`已撤销 ${rename.result?.renamed ?? 0} 个文件`)
  const byPath = new Map<string, string>()
  for (const p of rename.preview) byPath.set(p.newPath, p.oldName)
  files.value = files.value.map((f) => ({ ...f, name: byPath.get(f.path) ?? f.name }))
  await rename.refreshUndo()
}
</script>

<template>
  <div class="page">
    <h2>重命名</h2>
    <p class="muted">
      导入一个或多个视频文件（或整个文件夹）进行批量重命名。清单默认全选，可取消勾选部分文件。
      规则支持添加前缀与后缀，预览确认后执行，可撤销。
    </p>

    <n-card size="small" style="margin-bottom: 16px">
      <n-space align="center" wrap>
        <n-button type="primary" :loading="loading" @click="importFiles">
          <template #icon>
            <n-icon><AddOutline /></n-icon>
          </template>
          导入文件
        </n-button>
        <n-button :loading="loading" @click="importFolder">
          <template #icon>
            <n-icon><FolderOpenOutline /></n-icon>
          </template>
          导入文件夹
        </n-button>
        <n-button v-if="files.length" quaternary type="error" @click="clearAll">清空</n-button>
        <template v-if="files.length">
          <n-tag size="small" type="info" :bordered="false">
            已选 {{ selectedPaths.length }} / {{ files.length }}
          </n-tag>
          <n-button size="small" @click="selectAll(true)">全选</n-button>
          <n-button size="small" @click="selectAll(false)">取消全选</n-button>
        </template>
      </n-space>
    </n-card>

    <n-card size="small" style="margin-bottom: 16px" title="命名规则">
      <n-form label-placement="left" label-width="80">
        <div class="rule-grid">
          <n-form-item label="前缀">
            <n-input v-model:value="rename.rules.prefix" placeholder="如 [已整理] " />
          </n-form-item>
          <n-form-item label="后缀">
            <n-input v-model:value="rename.rules.suffix" placeholder="如 (1080p)" />
          </n-form-item>
        </div>
      </n-form>
    </n-card>

    <n-space style="margin-bottom: 12px">
      <n-button type="primary" :loading="rename.loading" :disabled="selectedFiles.length === 0" @click="preview">
        生成预览
      </n-button>
      <n-button v-if="rename.preview.length" quaternary @click="cancelPreview">
        取消预览
      </n-button>
      <n-button type="success" @click="apply">
        执行重命名
      </n-button>
      <n-button :disabled="!rename.undoAvailable" @click="undo">
        <template #icon>
          <n-icon><RefreshOutline /></n-icon>
        </template>
        撤销上次重命名
      </n-button>
    </n-space>

    <n-data-table
      v-if="files.length"
      :columns="columns"
      :data="files"
      size="small"
      :max-height="200"
      :row-key="(row: RenameFile) => row.path"
      :checked-row-keys="selectedPaths"
      @update:checked-row-keys="(keys: Array<string | number>) => (selectedPaths = keys as string[])"
      style="margin-bottom: 16px"
    />
    <n-empty v-else description="尚未导入文件" style="margin-top: 20px" />

    <template v-if="rename.preview.length">
      <n-alert
        v-if="rename.preview.filter((p) => p.conflict).length"
        type="warning"
        :show-icon="false"
        style="margin-bottom: 12px"
      >
        {{ rename.preview.filter((p) => p.conflict).length }} 个目标文件名已存在，将被跳过。
      </n-alert>
      <n-data-table
        :columns="previewColumns"
        :data="rename.preview"
        size="small"
        :max-height="280"
        :pagination="{ pageSize: 20 }"
      />
    </template>
  </div>
</template>

<style scoped>
.rule-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 16px;
}
</style>
