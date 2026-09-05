<script setup lang="ts">
/** 恢复/回滚历史记录：查看每次恢复的差异摘要与统计，支持一键回滚到恢复前快照 */
import { h, ref, watch } from 'vue'
import { NButton, NDataTable, NEmpty, NModal, NSpace, NSpin, NTag, useDialog, useMessage } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import type { RestoreLog, RestoreMode } from '../../../shared/types'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ 'update:show': [value: boolean] }>()

const dialog = useDialog()
const message = useMessage()

const logs = ref<RestoreLog[]>([])
const loading = ref(false)
const rolling = ref<number | null>(null)

const MODE_CN: Record<RestoreMode, string> = {
  full: '完全恢复',
  'backup-first': '备份优先',
  'local-first': '本地优先',
  'missing-only': '仅补缺'
}

function baseName(p: string | null): string {
  if (!p) return '—'
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}

/** 从日志的 stats/summary 拼出执行摘要 */
function actionSummary(row: RestoreLog): string {
  if (row.kind === 'rollback') return `回滚到 ${row.snapshotDir ? baseName(row.snapshotDir) : '快照'}`
  const st = row.stats
  if (row.result === 'failed') return row.error ?? '失败'
  if (!st) return '—'
  const parts = [`新增 ${st.inserted}`]
  if (st.updated) parts.push(`覆盖 ${st.updated}`)
  if (st.removed) parts.push(`移除 ${st.removed}`)
  if (st.skipped) parts.push(`跳过 ${st.skipped}`)
  if (st.gcRemoved) parts.push(`清理 ${st.gcRemoved}`)
  if (row.summary) parts.push(`本地独有保留 ${row.summary.localOnly}`)
  return parts.join(' · ')
}

async function load(): Promise<void> {
  loading.value = true
  try {
    logs.value = await window.api.listRestoreLogs(100)
  } finally {
    loading.value = false
  }
}

async function doRollback(log: RestoreLog): Promise<void> {
  const ok = await new Promise<boolean>((resolve) => {
    dialog.warning({
      title: '回滚到恢复前快照',
      content: `将把数据库还原到 ${log.createdAt} 的恢复（${MODE_CN[log.mode ?? 'backup-first']}）之前的状态。确认回滚？`,
      positiveText: '确认回滚',
      negativeText: '取消',
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onClose: () => resolve(false)
    })
  })
  if (!ok) return
  rolling.value = log.id
  try {
    const res = await window.api.rollbackRestoreSnapshot(log.id)
    if (res.ok) {
      message.success(`已回滚${res.gcRemoved ? `（清理孤儿图片 ${res.gcRemoved} 个）` : ''}`)
    } else {
      message.error(res.error ?? '回滚失败')
    }
  } finally {
    rolling.value = null
    await load()
  }
}

const columns: DataTableColumns<RestoreLog> = [
  {
    title: '时间',
    key: 'createdAt',
    width: 150,
    render: (row) => row.createdAt
  },
  {
    title: '类型',
    key: 'kind',
    width: 80,
    render: (row) =>
      row.kind === 'rollback'
        ? h(NTag, { size: 'small', type: 'default' }, { default: () => '回滚' })
        : h(NTag, { size: 'small', type: 'info' }, { default: () => '恢复' })
  },
  {
    title: '模式',
    key: 'mode',
    width: 100,
    render: (row) => (row.mode ? MODE_CN[row.mode] ?? row.mode : '—')
  },
  {
    title: '备份文件',
    key: 'backupFile',
    width: 220,
    ellipsis: { tooltip: true },
    render: (row) => baseName(row.backupFile)
  },
  {
    title: '执行摘要',
    key: 'summaryText',
    ellipsis: { tooltip: true },
    render: (row) => actionSummary(row)
  },
  {
    title: '结果',
    key: 'result',
    width: 100,
    render: (row) =>
      h(
        NTag,
        {
          size: 'small',
          type: row.result === 'ok' ? 'success' : row.result === 'rolled_back' ? 'warning' : 'error'
        },
        { default: () => (row.result === 'ok' ? '成功' : row.result === 'rolled_back' ? '已回滚' : '失败') }
      )
  },
  {
    title: '操作',
    key: 'actions',
    width: 100,
    render: (row) =>
      row.kind === 'restore' && row.result === 'ok' && row.snapshotDir
        ? h(
            NButton,
            {
              size: 'tiny',
              type: 'warning',
              secondary: true,
              loading: rolling.value === row.id,
              onClick: () => doRollback(row)
            },
            { default: () => '回滚' }
          )
        : '—'
  }
]

function close(): void {
  emit('update:show', false)
}

watch(
  () => props.show,
  (v) => {
    if (v) void load()
  }
)
</script>

<template>
  <n-modal :show="props.show" preset="card" title="恢复记录与回滚" :style="{ width: '960px' }" @update:show="(v: boolean) => emit('update:show', v)">
    <p class="muted-inline" style="margin-bottom: 10px">
      每次恢复前会自动创建数据库快照（保留最近 10 份）。对成功的恢复可一键回滚；回滚后当前数据将还原到该次恢复前的状态。
    </p>
    <n-spin :show="loading">
      <n-data-table v-if="logs.length" :columns="columns" :data="logs" size="small" :max-height="420" :bordered="false" />
      <n-empty v-else description="暂无恢复记录" style="padding: 32px" />
    </n-spin>
    <template #footer>
      <n-space justify="end">
        <n-button quaternary @click="load">刷新</n-button>
        <n-button type="primary" @click="close">关闭</n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<style scoped>
.muted-inline {
  color: var(--text-2);
  font-size: 12.5px;
}
</style>
