<script setup lang="ts">
import { computed, type Component, onMounted, ref } from 'vue'
import {
  NButton,
  NEmpty,
  NIcon,
  NList,
  NListItem,
  NPopconfirm,
  NProgress,
  NTag,
  useMessage,
  type TagProps
} from 'naive-ui'
import { CheckmarkCircleOutline, CloseCircleOutline, TimeOutline, TrashOutline } from '@vicons/ionicons5'
import { useImportStore } from '../stores/import'
import type { Task, TaskStatus, TaskType } from '../../../shared/types'

const store = useImportStore()
const message = useMessage()

const STATUS_META: Record<TaskStatus, { label: string; type: TagProps['type']; icon: Component }> = {
  pending: { label: '排队中', type: 'default', icon: TimeOutline },
  running: { label: '进行中', type: 'info', icon: TimeOutline },
  paused: { label: '已暂停', type: 'warning', icon: TimeOutline },
  done: { label: '已完成', type: 'success', icon: CheckmarkCircleOutline },
  failed: { label: '失败', type: 'error', icon: CloseCircleOutline },
  cancelled: { label: '已取消', type: 'warning', icon: CloseCircleOutline }
}

const TYPE_LABEL: Record<TaskType, string> = {
  import: '导入',
  thumbnail: '缩略图',
  convert: '转换',
  rename: '重命名'
}

const tasks = computed(() => store.tasks)

/** 正在执行操作的按钮（用于 loading / 防连点） */
const busyId = ref<number | null>(null)

/** 任务时间序号：created_at(YYYY-MM-DD HH:MM:SS) → YYYYMMDD-HH:MM:SS-id */
function taskSerial(t: { created_at: string; id: number }): string {
  const s = (t.created_at ?? '').replace(/[- :]/g, (m) => (m === '-' ? '' : m === ' ' ? '-' : m === ':' ? ':' : m))
  // 规范化：2026-08-30 23:55:45 → 20260830-23:55:45
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(t.created_at ?? '')
  if (m) return `${m[1]}${m[2]}${m[3]}-${m[4]}-${t.id}`
  return `${s}-${t.id}`
}

/** 按 类型 × 状态 的能力矩阵生成可用操作 */
type ActionKey = 'pause' | 'resume' | 'cancel' | 'retry' | 'delete'
interface TaskAction {
  key: ActionKey
  label: string
  danger: boolean
  /** 二次确认文案（仅破坏性/不可逆操作） */
  confirm?: string
}

function actionsFor(t: Task): TaskAction[] {
  switch (t.status) {
    case 'pending':
      return [
        { key: 'pause', label: '暂停', danger: false },
        { key: 'cancel', label: '取消', danger: true, confirm: '取消该排队任务？' },
        { key: 'delete', label: '删除', danger: true, confirm: '删除该排队任务？' }
      ]
    case 'running':
      if (t.type === 'convert') {
        // ffmpeg 无断点暂停：进行中的转换只允许取消
        return [
          {
            key: 'cancel',
            label: '取消',
            danger: true,
            confirm: '正在转换，取消将丢弃当前进度并清理半成品文件？'
          }
        ]
      }
      // 扫描在文件边界暂停/取消
      return [
        { key: 'pause', label: '暂停', danger: false },
        {
          key: 'cancel',
          label: '取消',
          danger: true,
          confirm: '正在扫描，取消将从下一个文件开始停止？'
        }
      ]
    case 'paused':
      return [
        { key: 'resume', label: '继续', danger: false },
        { key: 'cancel', label: '取消', danger: true, confirm: '取消该已暂停任务？' },
        { key: 'delete', label: '删除', danger: true, confirm: '删除该任务？' }
      ]
    case 'failed':
    case 'cancelled':
      return [
        { key: 'retry', label: '重试', danger: false },
        { key: 'delete', label: '删除', danger: true, confirm: '删除该条记录？' }
      ]
    case 'done':
      return [{ key: 'delete', label: '删除', danger: true, confirm: '删除该条记录？' }]
  }
}

async function runAction(t: Task, action: TaskAction): Promise<void> {
  busyId.value = t.id
  try {
    switch (action.key) {
      case 'pause':
        await store.pauseTask(t.id)
        message.success('已暂停（扫描将在当前文件完成后暂停）')
        break
      case 'resume':
        await store.resumeTask(t.id)
        message.success('已继续')
        break
      case 'cancel':
        await store.cancelTask(t.id)
        message.success('已请求取消')
        break
      case 'retry':
        await store.retryTask(t.id)
        message.success('已重新加入队列')
        break
      case 'delete':
        await store.deleteTask(t.id)
        message.success('已删除')
        break
    }
  } catch (err) {
    message.error(err instanceof Error ? err.message : '操作失败')
  } finally {
    busyId.value = null
  }
}

onMounted(() => {
  void store.loadTasks()
})

async function clearFinished(): Promise<void> {
  const res = await window.api.clearTasks()
  await store.loadTasks()
  message.success(`已清空 ${res.count} 条历史记录`)
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2>任务</h2>
        <p class="muted">导入 / 缩略图 / 转码 / 重命名任务队列，实时进度同步；支持单任务暂停 / 继续 / 取消 / 重试 / 删除。</p>
      </div>
      <n-popconfirm v-if="tasks.length" @positive-click="clearFinished">
        <template #trigger>
          <n-button size="small" type="error" secondary>
            <template #icon><n-icon><TrashOutline /></n-icon></template>
            清空任务记录
          </n-button>
        </template>
        将删除全部已完成 / 失败 / 已取消记录（排队中与进行中任务不受影响），确认？
      </n-popconfirm>
    </div>
    <n-list v-if="tasks.length" bordered>
      <n-list-item v-for="t in tasks" :key="t.id">
        <div class="task-row">
          <div class="task-head">
            <span class="task-title">
              {{ TYPE_LABEL[t.type] ?? t.type }} {{ taskSerial(t) }}
            </span>
            <n-tag size="small" :type="STATUS_META[t.status].type">
              <template #icon>
                <n-icon :component="STATUS_META[t.status].icon" />
              </template>
              {{ STATUS_META[t.status].label }}
            </n-tag>
            <span class="muted-inline">{{ t.created_at }}</span>
          </div>
          <n-progress
            v-if="t.status === 'pending' || t.status === 'running'"
            :percentage="Math.round((t.progress ?? 0) * 100)"
            :indicator-placement="'inside'"
            :height="10"
            style="margin-top: 8px"
          />
          <div v-if="t.message" class="task-msg">{{ t.message }}</div>
          <div class="task-actions">
            <template v-for="a in actionsFor(t)" :key="a.key">
              <n-popconfirm
                v-if="a.confirm"
                :positive-text="'确定'"
                :negative-text="'取消'"
                :disabled="busyId === t.id"
                @positive-click="runAction(t, a)"
              >
                <template #trigger>
                  <n-button
                    size="tiny"
                    :type="a.danger ? 'error' : 'default'"
                    quaternary
                    :loading="busyId === t.id"
                    :disabled="busyId !== null && busyId !== t.id"
                  >
                    {{ a.label }}
                  </n-button>
                </template>
                {{ a.confirm }}
              </n-popconfirm>
              <n-button
                v-else
                size="tiny"
                :type="a.danger ? 'error' : 'default'"
                quaternary
                :loading="busyId === t.id"
                :disabled="busyId !== null && busyId !== t.id"
                @click="runAction(t, a)"
              >
                {{ a.label }}
              </n-button>
            </template>
          </div>
        </div>
      </n-list-item>
    </n-list>
    <n-empty v-else description="暂无任务。在「导入」页添加文件夹并扫描" style="margin-top: 48px" />
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.task-row {
  width: 100%;
}

.task-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.task-title {
  font-weight: 600;
  font-size: 13px;
}

.muted-inline {
  color: var(--text-3);
  font-size: 12px;
}

.task-msg {
  color: var(--text-3);
  font-size: 12px;
  margin-top: 6px;
  word-break: break-all;
}

.task-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 8px;
}
</style>
