<script setup lang="ts">
import { ref } from 'vue'
import { NInput, NPopconfirm, NSelect } from 'naive-ui'
import { META_COLORS } from '../utils/metaColors'
interface MetaItem {
  id: number
  name: string
  videoCount: number
  color: string | null
}

const props = defineProps<{
  title: string
  subtitle: string
  items: MetaItem[]
  sortBy: 'name' | 'count'
  sortDir: 'asc' | 'desc'
  /** 标签模式：名称以浅色 Chip 展示 */
  chipMode?: boolean
  /** 是否显示「查看」按钮（分类） */
  showView?: boolean
  emptyText: string
}>()

const emit = defineEmits<{
  'update:sortBy': [v: 'name' | 'count']
  'update:sortDir': [v: 'asc' | 'desc']
  create: []
  view: [id: number]
  rename: [id: number, name: string, color: string | null]
  remove: [id: number]
}>()

const sortOptions = [
  { label: '按名称', value: 'name' },
  { label: '按数量', value: 'count' }
]
const dirOptions = [
  { label: '降序', value: 'desc' },
  { label: '升序', value: 'asc' }
]

// 行内编辑
const editState = ref<{ id: number; name: string; color: string | null } | null>(null)

function startEdit(item: MetaItem): void {
  editState.value = { id: item.id, name: item.name, color: item.color }
}

function confirmRename(): void {
  const es = editState.value
  if (!es) return
  if (!es.name.trim()) return
  emit('rename', es.id, es.name.trim(), es.color)
  editState.value = null
}

function onColorInput(e: Event): void {
  const es = editState.value
  if (!es) return
  const v = (e.target as HTMLInputElement).value
  es.color = es.color === v ? null : v
}

function chipStyle(item: MetaItem): Record<string, string> {
  if (item.color) {
    return { background: `${item.color}22`, color: '#333333', border: `1px solid ${item.color}55` }
  }
  return {}
}
</script>

<template>
  <div class="ml-section">
    <div class="ml-header">
      <div class="ml-head-left">
        <span class="ml-title">{{ title }}</span>
        <span class="ml-subtitle">{{ subtitle }}</span>
      </div>
      <div class="ml-tools">
        <n-select
          :value="sortBy"
          :options="sortOptions"
          size="small"
          style="width: 92px"
          @update:value="(v: 'name' | 'count') => emit('update:sortBy', v)"
        />
        <n-select
          :value="sortDir"
          :options="dirOptions"
          size="small"
          style="width: 66px"
          @update:value="(v: 'asc' | 'desc') => emit('update:sortDir', v)"
        />
        <button class="ml-create" @click="emit('create')">＋ 新建{{ title }}</button>
      </div>
    </div>

    <div class="ml-body">
      <template v-if="items.length">
        <!-- 行内编辑态 -->
        <div v-for="it in items" :key="it.id" class="ml-row">
          <template v-if="editState?.id === it.id">
            <n-input
              v-model:value="editState.name"
              size="small"
              style="width: 200px"
              @keyup.enter="confirmRename"
            />
            <div class="ml-swatches">
              <button
                v-for="col in META_COLORS"
                :key="col"
                class="ml-swatch"
                :class="{ active: editState.color === col }"
                :style="{ background: col }"
                @click="editState.color = editState.color === col ? null : col"
              />
              <label class="ml-picker" :title="'自定义颜色（当前：' + (editState.color ?? '无') + '）'">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 22a10 10 0 1 1 10-10c0 1.7-1.3 3-3 3h-2.2a2.8 2.8 0 0 0-2 4.8c.4.4.6.9.6 1.4 0 .7-.6 1.2-1.2 1.6-.8.4-1.5.7-2.2 1.2z" />
                  <circle cx="7.5" cy="11.5" r="1.2" fill="currentColor" stroke="none" />
                  <circle cx="10.5" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
                  <circle cx="15" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
                  <circle cx="18" cy="10.5" r="1.2" fill="currentColor" stroke="none" />
                </svg>
                <span class="ml-picker-dot" :style="{ background: editState.color ?? '#888888' }" />
                <input
                  type="color"
                  :value="editState.color ?? '#888888'"
                  @input="onColorInput"
                />
              </label>
            </div>
            <span class="ml-picker-hint">点击色盘可精确选色</span>
            <div class="ml-actions">
              <button class="ml-btn primary" @click="confirmRename">确认</button>
              <button class="ml-btn" @click="editState = null">取消</button>
            </div>
          </template>
          <template v-else>
            <span v-if="!chipMode" class="ml-dot" :style="{ background: it.color ?? 'transparent' }" />
            <span v-if="chipMode" class="ml-chip" :style="chipStyle(it)">{{ it.name }}</span>
            <span v-else class="ml-name">{{ it.name }}</span>
            <span class="ml-count">{{ it.videoCount }} 个视频</span>
            <div class="ml-actions">
              <button v-if="showView" class="ml-btn" @click="emit('view', it.id)">查看</button>
              <button class="ml-btn" @click="startEdit(it)">重命名</button>
              <n-popconfirm @positive-click="emit('remove', it.id)">
                <template #trigger>
                  <button class="ml-btn danger">删除</button>
                </template>
                确认删除{{ title }}「{{ it.name }}」？
              </n-popconfirm>
            </div>
          </template>
        </div>
      </template>
      <div v-else class="ml-empty">
        <p>{{ emptyText }}</p>
        <p class="ml-empty-hint">创建一个{{ title }}来整理你的视频</p>
        <button class="ml-create" @click="emit('create')">＋ 新建{{ title }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ml-section {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}

.ml-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}

.ml-head-left {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.ml-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
}

.ml-subtitle {
  font-size: 12px;
  color: var(--text-3);
}

.ml-tools {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ml-create {
  border: 1px solid var(--border-strong);
  background: transparent;
  color: var(--text-1);
  font-size: 13px;
  font-weight: 500;
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, border-color 0.15s;
}

.ml-create:hover {
  background: var(--bg-hover);
  border-color: var(--accent);
  color: var(--accent);
}

.ml-body {
  display: flex;
  flex-direction: column;
}

.ml-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 18px;
  min-height: 52px;
  transition: background 0.12s;
}

.ml-row:hover {
  background: var(--bg-hover);
}

.ml-row + .ml-row {
  border-top: 1px solid var(--border);
}

.ml-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  border: 1px solid var(--border-strong);
}

.ml-chip {
  font-size: 13px;
  font-weight: 500;
  padding: 4px 12px;
  border-radius: 6px;
  background: var(--bg-hover);
  color: var(--text-1);
}

.ml-name {
  flex: 1;
  font-size: 15px;
  font-weight: 500;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ml-count {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  min-width: 84px;
  text-align: right;
}

.ml-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  flex-shrink: 0;
}

.ml-btn {
  border: none;
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.ml-btn:hover {
  background: var(--bg-elevated);
  color: var(--text-1);
}

.ml-btn.primary {
  color: var(--accent);
}

.ml-btn.primary:hover {
  background: var(--accent-soft);
}

.ml-btn.danger {
  color: #c0392b;
}

.ml-btn.danger:hover {
  background: rgba(192, 57, 43, 0.1);
  color: #a93226;
}

.ml-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
}

.ml-swatch {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  border: 2px solid transparent;
  cursor: pointer;
}

.ml-swatch.active {
  border-color: var(--text-1);
}

.ml-picker {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid var(--border-strong);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  overflow: hidden;
  position: relative;
  background: var(--bg-elevated);
  color: var(--text-2);
}

.ml-picker:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.ml-picker-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
  flex-shrink: 0;
}

.ml-picker input[type='color'] {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  border: none;
  padding: 0;
}

.ml-picker-hint {
  font-size: 11px;
  color: var(--text-3);
}

.ml-empty {
  padding: 32px 18px;
  text-align: center;
  color: var(--text-2);
  font-size: 14px;
}

.ml-empty-hint {
  color: var(--text-3);
  font-size: 12px;
  margin: 6px 0 14px;
}
</style>
