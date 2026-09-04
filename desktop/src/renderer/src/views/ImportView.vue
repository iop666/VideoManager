<script setup lang="ts">
import {
  NButton,
  NCard,
  NEmpty,
  NIcon,
  NList,
  NListItem,
  NPopconfirm,
  NSpace,
  NSpin,
  NTag,
  useMessage
} from 'naive-ui'
import { FolderOpenOutline, PlayOutline, TrashOutline } from '@vicons/ionicons5'
import { useImportStore } from '../stores/import'

const store = useImportStore()
const message = useMessage()

async function handleAdd(): Promise<void> {
  const ok = await store.addFolder()
  if (ok) message.success('已添加导入文件夹')
}

async function handleScan(id: number): Promise<void> {
  await store.scanFolder(id)
  message.info('扫描已加入任务队列，见「任务」页')
}

async function handleRemove(id: number): Promise<void> {
  await store.removeFolder(id)
  message.success('已移除导入文件夹')
}
</script>

<template>
  <div class="page">
    <h2>导入</h2>
    <p class="muted">
      ffprobe 提取元数据、ffmpeg 生成缩略图，写入 SQLite 索引。
      二次扫描自动增量：未变化文件跳过、已删除文件标记缺失。
    </p>
    <n-space style="margin-bottom: 16px">
      <n-button type="primary" @click="handleAdd">
        <template #icon>
          <n-icon><FolderOpenOutline /></n-icon>
        </template>
        添加文件夹
      </n-button>
    </n-space>
    <n-card size="small">
      <n-spin :show="store.foldersLoading">
        <n-list v-if="store.folders.length" bordered>
          <n-list-item v-for="f in store.folders" :key="f.id">
            <div class="folder-row">
              <div class="folder-info">
                <div class="folder-path">{{ f.path }}</div>
                <div class="folder-meta">
                  <n-tag size="small" :type="f.recursive ? 'info' : 'default'">
                    {{ f.recursive ? '含子目录' : '仅当前目录' }}
                  </n-tag>
                  <span v-if="f.last_scanned_at" class="muted-inline">
                    上次扫描：{{ f.last_scanned_at }}
                  </span>
                  <span v-else class="muted-inline">尚未扫描</span>
                </div>
              </div>
              <n-space>
                <n-button size="small" @click="handleScan(f.id)">
                  <template #icon>
                    <n-icon><PlayOutline /></n-icon>
                  </template>
                  扫描
                </n-button>
                <n-popconfirm @positive-click="handleRemove(f.id)">
                  <template #trigger>
                    <n-button size="small" type="error" quaternary title="移除文件夹">
                      <template #icon>
                        <n-icon><TrashOutline /></n-icon>
                      </template>
                    </n-button>
                  </template>
                  移除文件夹「{{ f.path }}」？视频记录与元数据将保留，仅停止后续扫描。
                </n-popconfirm>
              </n-space>
            </div>
          </n-list-item>
        </n-list>
        <n-empty v-else description="尚未添加导入文件夹" />
      </n-spin>
    </n-card>
  </div>
</template>

<style scoped>
.folder-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
}

.folder-path {
  font-weight: 600;
  font-size: 13px;
  word-break: break-all;
}

.folder-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 4px;
}

.muted-inline {
  color: var(--text-3);
  font-size: 12px;
}
</style>
