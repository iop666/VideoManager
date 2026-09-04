<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  NButton,
  NDescriptions,
  NDescriptionsItem,
  NDivider,
  NDrawer,
  NDrawerContent,
  NInput,
  NRate,
  NSelect,
  NSpace,
  NTag,
  useMessage
} from 'naive-ui'
import { useAppStore } from '../stores/app'
import { useLibraryStore } from '../stores/library'
import { useMetaStore } from '../stores/meta'
import { formatBytes, formatDuration } from '../utils/format'
import type { MetaSortConfig, VideoListItem } from '../../../shared/types'

const props = defineProps<{ videoId: number | null }>()
const emit = defineEmits<{ close: []; updated: [id: number] }>()

const app = useAppStore()
const library = useLibraryStore()
const meta = useMetaStore()
const message = useMessage()

const video = ref<VideoListItem | null>(null)
const loading = ref(false)
const saving = ref(false)

const editTitle = ref('')
const editCategory = ref<number | null>(null)
const editAuthor = ref<number | null>(null)
const editRating = ref<number | null>(null)
const editRemark = ref('')
const editFavorite = ref(false)
const editTags = ref<string[]>([])

/** 按设置的分页排序规则生成下拉选项：名称（数量） */
interface IdOpt {
  id: number
  name: string
  videoCount: number
}
function sortMetaList(list: IdOpt[], rule: { by: 'name' | 'count'; dir: 'asc' | 'desc' }): IdOpt[] {
  const arr = [...list]
  arr.sort((a, b) => {
    const cmp = rule.by === 'name' ? a.name.localeCompare(b.name, 'zh-Hans-CN') : a.videoCount - b.videoCount
    return rule.dir === 'asc' ? cmp : -cmp
  })
  return arr
}

const sortCfg = computed<MetaSortConfig>(() => app.metaEditSort)

/** 分类/作者下拉：按设置规则排序（显示名称与数量） */
const categoryOptions = computed(() =>
  sortMetaList(meta.categories, sortCfg.value.category).map((c) => ({
    label: `${c.name}（${c.videoCount}）`,
    value: c.id
  }))
)
const authorOptions = computed(() =>
  sortMetaList(meta.authors, sortCfg.value.author).map((a) => ({
    label: `${a.name}（${a.videoCount}）`,
    value: a.id
  }))
)
/** 标签多选：仅可选用已有标签（不能新建），value 为标签名，按设置规则排序 */
const tagNameOptions = computed(() =>
  sortMetaList(meta.tags, sortCfg.value.tag).map((t) => ({ label: t.name, value: t.name }))
)

/** 本地位置：本地存在则显示路径，否则显示「无本地文件」 */
const localPath = computed<string>(() => {
  const v = video.value
  if (!v) return '无本地文件'
  const p = v.filePath ?? ''
  const isRestored = p.startsWith('restored://')
  const missing = v.status === 'missing'
  if (!p || isRestored || missing) return '无本地文件'
  return p
})

/** 历史文件名记录（只读展示，用户不可修改） */
const moreFileNames = computed<string[]>(() => video.value?.moreFileNames ?? [])

watch(
  () => props.videoId,
  (id) => {
    if (id) void load(id)
  },
  { immediate: true }
)

onMounted(() => {
  void app.loadMetaEditSort()
})

async function load(id: number): Promise<void> {
  loading.value = true
  try {
    video.value = await window.api.getVideo(id)
    if (video.value) {
      editTitle.value = video.value.title
      editCategory.value = video.value.categoryId
      editAuthor.value = video.value.authorId
      editRating.value = video.value.rating
      editRemark.value = video.value.remark ?? ''
      editFavorite.value = video.value.isFavorite === 1
      editTags.value = [...video.value.tags]
    }
  } finally {
    loading.value = false
  }
}

async function save(): Promise<void> {
  if (!video.value) return
  saving.value = true
  try {
    await window.api.updateVideo(video.value.id, {
      title: editTitle.value,
      categoryId: editCategory.value,
      authorId: editAuthor.value,
      rating: editRating.value,
      remark: editRemark.value,
      isFavorite: editFavorite.value
    })
    // 深拷贝：editTags 是 reactive 数组，IPC 无法克隆 Vue Proxy（同重命名教训）
    await window.api.setVideoTags(video.value.id, JSON.parse(JSON.stringify(editTags.value)))
    await library.refreshItem(video.value.id)
    await meta.load()
    await load(video.value.id)
    message.success('已保存')
    emit('updated', video.value.id)
  } finally {
    saving.value = false
  }
}

/** 当前视频的分类/作者颜色（展示用） */
const categoryColor = computed(
  () => meta.categories.find((c) => c.id === editCategory.value)?.color ?? null
)
const authorColor = computed(
  () => meta.authors.find((a) => a.id === editAuthor.value)?.color ?? null
)
const tagColors = computed(() => {
  const map = new Map(meta.tags.map((t) => [t.name, t.color]))
  return editTags.value.map((name) => ({ name, color: map.get(name) ?? null }))
})
</script>

<template>
  <n-drawer :show="videoId !== null" :width="520" @update:show="(v: boolean) => !v && emit('close')">
    <n-drawer-content
      title="编辑元数据"
      closable
      :native-scrollbar="false"
      :footer-style="{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }"
    >
      <template v-if="video">
        <div class="meta-title">{{ video.title }}</div>
        <div class="meta-hash">SHA-256：{{ video.sha256 ?? '未计算' }}</div>

        <div class="edit-row">
          <span class="edit-label">标题</span>
          <n-input v-model:value="editTitle" placeholder="标题" />
        </div>
        <div class="edit-row">
          <span class="edit-label">分类</span>
          <n-select
            v-model:value="editCategory"
            :options="categoryOptions"
            placeholder="选择已有分类"
            clearable
          />
        </div>
        <div class="edit-row">
          <span class="edit-label">作者</span>
          <n-select
            v-model:value="editAuthor"
            :options="authorOptions"
            placeholder="选择已有作者"
            clearable
          />
        </div>
        <div class="edit-row">
          <span class="edit-label">标签</span>
          <n-select
            v-model:value="editTags"
            :options="tagNameOptions"
            multiple
            :max-tag-count="8"
            placeholder="选择已有标签（最多 10 个）"
          />
        </div>
        <div class="edit-row">
          <span class="edit-label">评分</span>
          <n-rate :value="editRating ?? 0" :count="10" @update:value="(v: number) => (editRating = v || null)" />
        </div>
        <div class="edit-row">
          <span class="edit-label">备注</span>
          <n-input v-model:value="editRemark" type="textarea" :rows="2" placeholder="备注" />
        </div>

        <n-divider />

        <div class="preview-title">效果预览（按所选颜色）</div>
        <n-space align="center" wrap>
          <n-tag v-if="editCategory" :bordered="false" :color="{ color: categoryColor ?? '#888', textColor: '#fff' }">
            分类：{{ meta.categories.find((c) => c.id === editCategory)?.name }}
          </n-tag>
          <n-tag v-if="editAuthor" :bordered="false" :color="{ color: authorColor ?? '#888', textColor: '#fff' }">
            作者：{{ meta.authors.find((a) => a.id === editAuthor)?.name }}
          </n-tag>
          <n-tag
            v-for="t in tagColors"
            :key="t.name"
            :bordered="false"
            :color="{ color: t.color ?? '#555', textColor: '#fff' }"
          >
            {{ t.name }}
          </n-tag>
        </n-space>

        <n-divider />

        <div class="preview-title">文件信息</div>
        <n-descriptions :column="2" size="small" label-placement="left">
          <n-descriptions-item label="大小">{{ formatBytes(video.fileSize) }}</n-descriptions-item>
          <n-descriptions-item label="时长">{{ formatDuration(video.duration) }}</n-descriptions-item>
          <n-descriptions-item label="分辨率">
            {{ video.width && video.height ? `${video.width}×${video.height}` : '--' }}
          </n-descriptions-item>
          <n-descriptions-item label="编码">{{ video.codec ?? '--' }}</n-descriptions-item>
          <n-descriptions-item label="格式">{{ (video.format ?? '--').toUpperCase() }}</n-descriptions-item>
          <n-descriptions-item label="状态">{{ video.status === 'missing' ? '文件缺失' : '正常' }}</n-descriptions-item>
          <n-descriptions-item label="播放次数">{{ video.playCount }}</n-descriptions-item>
          <n-descriptions-item label="加入时间">{{ video.dateAdded }}</n-descriptions-item>
        </n-descriptions>
        <div class="meta-local">本地位置：{{ localPath }}</div>

        <!-- 文件名记录（只读）：同一哈希身份历史导入过的文件名 -->
        <n-divider />
        <div class="preview-title">文件名记录</div>
        <template v-if="moreFileNames.length">
          <div v-for="(n, i) in moreFileNames" :key="i" class="meta-local">
            {{ i + 1 }}. {{ n }}
          </div>
        </template>
        <div v-else class="meta-local">无记录（首次导入本地文件后自动记录）</div>
      </template>

      <template #footer>
        <div class="drawer-footer">
          <n-button quaternary :class="{ 'fav-active': editFavorite }" @click="editFavorite = !editFavorite">
            <template #icon>
              <span class="fav-heart">♥</span>
            </template>
            {{ editFavorite ? '已收藏' : '收藏' }}
          </n-button>
          <n-space>
            <n-button quaternary @click="emit('close')">关闭</n-button>
            <n-button type="primary" :loading="saving" @click="save">保存</n-button>
          </n-space>
        </div>
      </template>
    </n-drawer-content>
  </n-drawer>
</template>

<style scoped>
.drawer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.fav-heart {
  font-size: 13px;
  line-height: 1;
  color: #ff5c7a;
}

.fav-active {
  color: #ff5c7a !important;
}

.meta-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--accent);
  word-break: break-all;
  line-height: 1.4;
}

.meta-hash {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  color: var(--text-3);
  margin-top: 6px;
  word-break: break-all;
}

.meta-local {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  color: var(--text-3);
  margin-top: 8px;
  word-break: break-all;
}

.edit-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}

.edit-label {
  width: 48px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
  flex-shrink: 0;
}

.edit-row > :nth-child(2) {
  flex: 1;
}

.preview-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  margin-bottom: 8px;
}
</style>
