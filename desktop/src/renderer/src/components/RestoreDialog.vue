<script setup lang="ts">
/**
 * 恢复备份安全向导：
 * 选择备份 → 完整性校验 + 差异分析 → 选择恢复模式 → 执行（自动快照，可回滚）→ 结果
 */
import { computed, h, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NDataTable,
  NDescriptions,
  NDescriptionsItem,
  NEmpty,
  NModal,
  NRadio,
  NRadioButton,
  NRadioGroup,
  NSpin,
  NSpace,
  NTag,
  NText,
  useDialog,
  useMessage
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import type {
  RestoreDiffItem,
  RestoreDiffKind,
  RestoreExecuteResult,
  RestoreMode,
  RestorePlanResult,
  RestoreStats,
  RestoreSummary
} from '../../../shared/types'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ 'update:show': [value: boolean] }>()

const dialog = useDialog()
const message = useMessage()

type Stage = 'intro' | 'loading' | 'summary' | 'running' | 'done'
const stage = ref<Stage>('intro')
const plan = ref<RestorePlanResult | null>(null)
const mode = ref<RestoreMode>('backup-first')
const result = ref<RestoreExecuteResult | null>(null)
const rolledBack = ref(false)
const busy = ref(false)

const summary = computed<RestoreSummary | null>(() => plan.value?.summary ?? null)

const MODE_OPTIONS: Array<{ value: RestoreMode; label: string; desc: string; warning?: string }> = [
  {
    value: 'missing-only',
    label: '仅补缺（最安全）',
    desc: '只新增本地缺失的备份条目，已有记录一概不动。'
  },
  {
    value: 'local-first',
    label: '本地优先合并',
    desc: '两边都有且不一致时保留本地元数据；仅新增备份独有的条目；本地独有保留。'
  },
  {
    value: 'backup-first',
    label: '备份优先合并',
    desc: '两边都有且不一致时以备份内容覆盖本地；仅新增备份独有的条目；本地独有保留。'
  },
  {
    value: 'full',
    label: '完全恢复（清空重建）',
    desc: '清空当前全部记录后按备份整体重建，最彻底；恢复前自动创建快照，可一键回滚。',
    warning: '完全恢复会移除本地独有记录'
  }
]

const KIND_LABEL: Record<RestoreDiffKind, string> = {
  backupOnly: '仅备份有',
  localOnly: '仅本地有',
  conflict: '元数据冲突',
  identical: '完全一致'
}
const CONFLICT_FIELD_CN: Record<string, string> = {
  title: '标题',
  category: '分类',
  tags: '标签',
  author: '作者',
  rating: '评分',
  remark: '备注',
  favorite: '收藏'
}

async function start(): Promise<void> {
  stage.value = 'loading'
  plan.value = null
  result.value = null
  rolledBack.value = false
  mode.value = 'backup-first'
  const res = await window.api.planRestoreBackup()
  if (!res.ok) {
    message.error(res.error ?? '分析备份失败')
    stage.value = 'intro'
    return
  }
  plan.value = res
  stage.value = 'summary'
}

function confirmFields(): string[] {
  const s = summary.value
  if (!s) return []
  const out: string[] = []
  if (s.legacy) out.push('旧版备份格式（兼容导入）')
  if (s.duplicatesInBackup > 0) out.push(`备份内有 ${s.duplicatesInBackup} 条重复指纹已自动合并`)
  if (s.invalidEntries > 0) out.push(`${s.invalidEntries} 条无效记录已忽略（SHA-256 非法）`)
  if (s.missingCovers > 0) out.push(`${s.missingCovers} 条缺少封面图片（可重建，不影响元数据）`)
  return out
}

async function execute(): Promise<void> {
  const s = summary.value
  if (!s) return
  const opt = MODE_OPTIONS.find((m) => m.value === mode.value)
  let content = `按「${opt?.label ?? mode.value}」恢复「${plan.value?.backupName ?? ''}」。执行前会自动创建数据库快照，恢复后可一键回滚到当前状态。`
  if (mode.value === 'full' && s.localOnly > 0) {
    content = `将清空当前全部 ${s.localTotal} 条记录，其中本地独有的 ${s.localOnly} 条会被移除（仅元数据，不动视频文件），再按备份重建 ${s.backupTotal} 条。恢复前会自动创建可回滚快照。`
  }
  const ok = await new Promise<boolean>((resolve) => {
    dialog.warning({
      title: '确认执行恢复',
      content,
      positiveText: '执行恢复',
      negativeText: '取消',
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onClose: () => resolve(false),
      onMaskClick: () => resolve(false)
    })
  })
  if (!ok) return
  busy.value = true
  stage.value = 'running'
  try {
    const res = await window.api.executeRestoreBackup(mode.value)
    if (res.ok) {
      result.value = res
      stage.value = 'done'
      message.success('恢复完成（已自动创建可回滚快照）')
    } else {
      message.error(res.error ?? '恢复失败（数据库已整体回滚，可调整模式重试）')
      stage.value = 'summary'
    }
  } finally {
    busy.value = false
  }
}

async function doRollback(): Promise<void> {
  const r = result.value
  if (!r?.logId) return
  const ok = await new Promise<boolean>((resolve) => {
    dialog.warning({
      title: '回滚到恢复前状态',
      content: '将把数据库还原到本次恢复前自动创建的快照（封面/关键帧等生成文件由垃圾回收自动对齐）。确认回滚？',
      positiveText: '确认回滚',
      negativeText: '取消',
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onClose: () => resolve(false)
    })
  })
  if (!ok) return
  busy.value = true
  try {
    const res = await window.api.rollbackRestoreSnapshot(r.logId!)
    if (res.ok) {
      rolledBack.value = true
      message.success(`已回滚到恢复前状态${res.gcRemoved ? `（清理孤儿图片 ${res.gcRemoved} 个）` : ''}`)
    } else {
      message.error(res.error ?? '回滚失败')
    }
  } finally {
    busy.value = false
  }
}

// ---- 差异明细 ----
const showDiff = ref(false)
const diffKind = ref<RestoreDiffKind | 'all'>('conflict')
const diffItems = ref<RestoreDiffItem[]>([])
const diffLoading = ref(false)

async function openDiff(kind: RestoreDiffKind | 'all'): Promise<void> {
  diffKind.value = kind
  showDiff.value = true
  await loadDiff()
}

async function loadDiff(): Promise<void> {
  diffLoading.value = true
  try {
    diffItems.value = await window.api.getRestoreDiff(diffKind.value === 'all' ? null : diffKind.value)
  } finally {
    diffLoading.value = false
  }
}

const diffColumns: DataTableColumns<RestoreDiffItem> = [
  {
    title: '指纹 (SHA-256)',
    key: 'sha256',
    width: 120,
    render: (row) => row.sha256.slice(0, 12) + '…'
  },
  {
    title: '差异',
    key: 'kind',
    width: 110,
    render: (row) =>
      h(
        NTag,
        {
          size: 'small',
          type:
            row.kind === 'conflict'
              ? 'warning'
              : row.kind === 'backupOnly'
                ? 'info'
                : row.kind === 'localOnly'
                  ? 'default'
                  : 'success'
        },
        { default: () => KIND_LABEL[row.kind] }
      )
  },
  {
    title: '标题（备份 → 本地）',
    key: 'title',
    minWidth: 240,
    render: (row) =>
      h('div', { style: 'line-height: 1.9' }, [
        h(
          'div',
          row.backupTitle === row.localTitle
            ? { style: 'color: var(--text-1)' }
            : { style: 'color: var(--accent, #ff8533); font-weight: 600' },
          { default: () => '备份：' + (row.backupTitle ?? '—') }
        ),
        h('div', { style: 'color: var(--text-2)' }, { default: () => '本地：' + (row.localTitle ?? '—') })
      ])
  },
  {
    title: '分类（备份 → 本地）',
    key: 'category',
    width: 190,
    render: (row) => (row.backupCategory ?? '—') + (row.backupCategory !== row.localCategory ? ` → ${row.localCategory ?? '—'}` : '')
  },
  {
    title: '作者（备份 → 本地）',
    key: 'author',
    width: 170,
    render: (row) => (row.backupAuthor ?? '—') + (row.backupAuthor !== row.localAuthor ? ` → ${row.localAuthor ?? '—'}` : '')
  },
  {
    title: '冲突字段',
    key: 'conflictFields',
    width: 190,
    render: (row) =>
      row.conflictFields.length === 0 ? '—' : row.conflictFields.map((f) => CONFLICT_FIELD_CN[f] ?? f).join('、')
  }
]

function statsLine(st: RestoreStats): string {
  const parts = [
    `新增 ${st.inserted}`,
    st.updated ? `覆盖 ${st.updated}` : '',
    st.removed ? `移除 ${st.removed}` : '',
    st.skipped ? `跳过 ${st.skipped}` : '',
    `封面 ${st.coversWritten}${st.coversFailed ? `(+${st.coversFailed}失败)` : ''}`,
    `关键帧 ${st.keyframesWritten}`,
    `清理孤儿 ${st.gcRemoved}`,
    `${(st.elapsedMs / 1000).toFixed(1)}s`
  ]
  return parts.filter(Boolean).join(' · ')
}

function close(): void {
  emit('update:show', false)
}

watch(
  () => props.show,
  (v) => {
    if (!v) {
      // 关闭后重置向导状态
      setTimeout(() => {
        stage.value = 'intro'
        plan.value = null
        result.value = null
        rolledBack.value = false
        busy.value = false
        showDiff.value = false
      }, 200)
    }
  }
)
</script>

<template>
  <n-modal :show="props.show" :mask-closable="false" preset="card" class="restore-modal" :style="{ width: '640px' }" title="恢复备份" @update:show="(v: boolean) => emit('update:show', v)">
    <!-- 步骤 1：选择备份 -->
    <div v-if="stage === 'intro'" class="restore-intro">
      <p class="muted-inline">
        恢复前将校验备份完整性并对比本地差异（备份独有 / 本地独有 / 冲突 / 一致），
        你可以选择恢复模式；执行前会自动创建数据库快照，之后可一键回滚。
      </p>
      <ul class="restore-notes">
        <li>备份不含视频文件与绝对路径，恢复出的记录会以占位形式存在，重新扫描文件夹后自动认领本地文件。</li>
        <li>程序生成的封面与关键帧仅在引用计数归零后由垃圾回收清理，绝不会删除你的视频文件。</li>
      </ul>
      <n-space>
        <n-button type="primary" @click="start">选择备份文件并分析</n-button>
      </n-space>
    </div>

    <!-- 步骤 2：分析中 / 执行中 -->
    <div v-else-if="stage === 'loading' || stage === 'running'" class="restore-center">
      <n-spin size="large" />
      <p class="muted-inline" style="margin-top: 12px">
        {{ stage === 'loading' ? '正在校验备份并对比本地差异…' : '正在执行恢复（自动快照 → 事务 → 图片 → 清理）…' }}
      </p>
    </div>

    <!-- 步骤 3：差异摘要 + 模式选择 -->
    <div v-else-if="stage === 'summary' && summary">
      <n-descriptions :column="3" size="small" label-placement="left" bordered>
        <n-descriptions-item label="备份文件">{{ plan?.backupName }}</n-descriptions-item>
        <n-descriptions-item label="备份条目">{{ summary.backupTotal }}</n-descriptions-item>
        <n-descriptions-item label="本地记录">{{ summary.localTotal }}</n-descriptions-item>
        <n-descriptions-item label="备份独有">
          <n-text type="info" :strong="summary.backupOnly > 0">{{ summary.backupOnly }}</n-text>
        </n-descriptions-item>
        <n-descriptions-item label="本地独有">
          <n-text type="warning" :strong="summary.localOnly > 0">{{ summary.localOnly }}</n-text>
        </n-descriptions-item>
        <n-descriptions-item label="元数据冲突">
          <n-text type="error" :strong="summary.conflict > 0">{{ summary.conflict }}</n-text>
        </n-descriptions-item>
        <n-descriptions-item label="完全一致">{{ summary.identical }}</n-descriptions-item>
        <n-descriptions-item label="备注" :span="2">
          <span v-if="confirmFields().length" class="muted-inline">{{ confirmFields().join('；') }}</span>
          <span v-else class="muted-inline">无</span>
        </n-descriptions-item>
      </n-descriptions>

      <n-space style="margin-top: 12px">
        <n-button size="small" quaternary @click="openDiff('conflict')">查看冲突明细</n-button>
        <n-button size="small" quaternary @click="openDiff('backupOnly')">仅备份有</n-button>
        <n-button size="small" quaternary @click="openDiff('localOnly')">仅本地有</n-button>
      </n-space>

      <div style="margin-top: 16px">
        <div class="restore-mode-title">恢复模式</div>
        <n-radio-group v-model:value="mode">
          <div class="restore-mode-list">
            <label v-for="opt in MODE_OPTIONS" :key="opt.value" class="restore-mode-item">
              <n-radio :value="opt.value" />
              <div class="restore-mode-body">
                <div class="restore-mode-label">{{ opt.label }}</div>
                <div class="muted-inline">{{ opt.desc }}</div>
                <div v-if="opt.warning && opt.value === mode && summary.localOnly > 0" class="restore-mode-warn">
                  ⚠ {{ opt.warning }}（本地独有 {{ summary.localOnly }} 条）
                </div>
              </div>
            </label>
          </div>
        </n-radio-group>
      </div>

      <n-space justify="end" style="margin-top: 18px">
        <n-button quaternary @click="close">取消</n-button>
        <n-button type="primary" :loading="busy" @click="execute">执行恢复</n-button>
      </n-space>
    </div>

    <!-- 步骤 4：完成 -->
    <div v-else-if="stage === 'done' && result">
      <n-alert v-if="result.ok" type="success" :show-icon="true" style="margin-bottom: 12px">
        恢复完成（模式：{{ MODE_OPTIONS.find((m) => m.value === mode)?.label }}）
      </n-alert>
      <div v-if="result.stats" class="restore-stats">{{ statsLine(result.stats) }}</div>
      <div v-if="result.snapshotDir" class="muted-inline" style="margin-top: 6px; word-break: break-all">
        恢复前快照：{{ result.snapshotDir }}
      </div>
      <n-alert v-if="rolledBack" type="success" :show-icon="true" style="margin-top: 12px">
        已回滚到本次恢复前的状态。
      </n-alert>
      <n-space justify="end" style="margin-top: 18px">
        <n-button v-if="result.ok && !rolledBack" type="warning" secondary :loading="busy" @click="doRollback">
          回滚到恢复前快照
        </n-button>
        <n-button type="primary" @click="close">完成</n-button>
      </n-space>
    </div>

    <!-- 差异明细弹窗 -->
    <n-modal v-model:show="showDiff" preset="card" title="差异明细" :style="{ width: '860px' }">
      <n-space style="margin-bottom: 10px">
        <n-radio-group v-model:value="diffKind" size="small" @update:value="loadDiff">
          <n-radio-button value="conflict">冲突</n-radio-button>
          <n-radio-button value="backupOnly">仅备份有</n-radio-button>
          <n-radio-button value="localOnly">仅本地有</n-radio-button>
          <n-radio-button value="identical">一致</n-radio-button>
          <n-radio-button value="all">全部</n-radio-button>
        </n-radio-group>
      </n-space>
      <n-spin :show="diffLoading">
        <n-data-table
          v-if="diffItems.length"
          :columns="diffColumns"
          :data="diffItems"
          :max-height="420"
          size="small"
          :bordered="false"
        />
        <n-empty v-else description="该类别下没有条目" style="padding: 24px" />
      </n-spin>
    </n-modal>
  </n-modal>
</template>

<style scoped>
.restore-modal :deep(.n-card__content) {
  max-height: 74vh;
  overflow-y: auto;
}
.restore-intro p {
  margin: 0 0 10px;
}
.restore-notes {
  margin: 0 0 16px;
  padding-left: 18px;
  color: var(--text-2);
  font-size: 12.5px;
  line-height: 1.8;
}
.restore-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 28px 0;
}
.restore-mode-title {
  font-size: 13px;
  color: var(--text-2);
  margin-bottom: 8px;
}
.restore-mode-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.restore-mode-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.09));
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.2s;
}
.restore-mode-item:hover {
  border-color: var(--primary-color, #ff8533);
}
.restore-mode-body {
  flex: 1;
  line-height: 1.6;
}
.restore-mode-label {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-1);
}
.restore-mode-warn {
  margin-top: 4px;
  color: #f0a020;
  font-size: 12px;
}
.restore-stats {
  font-size: 12.5px;
  color: var(--text-2);
  line-height: 1.8;
}
</style>
