<script setup lang="ts">
import { computed, type Component, onMounted } from 'vue'
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
import type { TaskStatus, TaskType } from '../../../shared/types'

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

/** 任务时间序号：created_at(YYYY-MM-DD HH:MM:SS) → YYYYMMDD-HH:MM:SS-id */
function taskSerial(t: { created_at: string; id: number }): string {
  const s = (t.created_at ?? '').replace(/[- :]/g, (m) => (m === '-' ? '' : m === ' ' ? '-' : m === ':' ? ':' : m))
  // 规范化：2026-08-30 23:55:45 → 20260830-23:55:45
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(t.created_at ?? '')
  if (m) return `${m[1]}${m[2]}${m[3]}-${m[4]}-${t.id}`
  return `${s}-${t.id}`
}

onMounted(() => {
  void store.loadTasks()
})

async function clearAll(): Promise<void> {
  const res = await window.api.clearTasks()
  await store.loadTasks()
  message.success(`已清空 ${res.count} 条任务记录`)
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2>任务</h2>
        <p class="muted">导入 / 缩略图 / 转码 / 重命名任务队列，实时进度同步。</p>
      </div>
      <n-popconfirm v-if="tasks.length" @positive-click="clearAll">
        <template #trigger>
          <n-button size="small" type="error" secondary>
            <template #icon><n-icon><TrashOutline /></n-icon></template>
            清空任务记录
          </n-button>
        </template>
        将删除全部 {{ tasks.length }} 条任务记录（正在执行的任务不受影响），确认？
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
</style>
