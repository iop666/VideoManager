<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NEmpty,
  NIcon,
  NInput,
  NInputNumber,
  NRadio,
  NRadioGroup,
  NSpace,
  NSpin,
  NSwitch,
  NTag,
  useDialog,
  useMessage
} from 'naive-ui'
import { RefreshOutline, SaveOutline, SearchOutline, StopOutline, CloudUploadOutline, FolderOpenOutline, ArchiveOutline } from '@vicons/ionicons5'
import { useAppStore } from '../stores/app'
import { useThemeStore } from '../stores/theme'
import { ACCENTS, type AccentKey, type ThemeMode } from '../theme'
import type { ServerStatus } from '../../../shared/types'

const store = useAppStore()
const theme = useThemeStore()
const message = useMessage()
const dialog = useDialog()

const potPlayerPath = ref('')
const detecting = ref(false)

const serverStatus = ref<ServerStatus | null>(null)
const serverPort = ref(8720)
const restarting = ref(false)

const themeModeOptions = [
  { label: '跟随系统', value: 'auto' as ThemeMode },
  { label: '明亮', value: 'light' as ThemeMode },
  { label: '深色', value: 'dark' as ThemeMode }
]

const pageSize = ref(50)
/** 默认每页选项 */
const pageSizeOptions = [18, 30, 50].map((v) => ({ label: `${v} 个`, value: v }))
/** 自定义范围 */
const pageSizeMin = 4
const pageSizeMax = 100
/** 是否为自定义值（不在默认选项里） */
const pageSizeCustom = computed(() => !pageSizeOptions.some((o) => o.value === pageSize.value))
const metaBusy = ref(false)

// 元数据备份
const backupDir = ref('')
const backupAuto = ref(false)
const backupCount = ref(0)
const backupLastAt = ref<string | null>(null)
const backupBusy = ref(false)

async function loadBackup(): Promise<void> {
  const res = await window.api.getMetaBackup()
  backupDir.value = res.dir
  backupAuto.value = res.auto
  backupCount.value = res.count
  backupLastAt.value = res.lastBackupAt
}

async function chooseBackupDir(): Promise<void> {
  const dir = await window.api.selectFolder()
  if (!dir) return
  backupDir.value = dir
  await window.api.setMetaBackup({ dir })
  await loadBackup()
  message.success('备份目录已设置')
}

async function toggleBackupAuto(v: boolean): Promise<void> {
  backupAuto.value = v
  await window.api.setMetaBackup({ auto: v })
  message.success(v ? '已开启自动备份（元数据保存后自动备份）' : '已关闭自动备份')
}

async function doBackupNow(): Promise<void> {
  backupBusy.value = true
  try {
    const res = await window.api.backupMetaNow()
    if (res.ok) {
      message.success(`已备份到：${res.path}`)
      await loadBackup()
    } else {
      message.error(res.error ?? '备份失败')
    }
  } finally {
    backupBusy.value = false
  }
}

/** 恢复备份：删除当前全部数据后恢复 */
async function doRestoreMeta(): Promise<void> {
  metaBusy.value = true
  try {
    // 第一步：选备份文件并解析统计
    const preview = await window.api.restoreMetaBackup()
    if (!preview.ok) {
      message.error(preview.error ?? '恢复失败')
      return
    }
    // 确认：恢复会删除当前全部数据
    const action = await new Promise<'restore' | 'cancel'>((resolve) => {
      dialog.warning({
        title: '恢复备份',
        content: `将删除当前全部 ${preview.total ?? 0} 条视频数据与元数据，然后恢复所选备份。此操作不可撤销，确认继续？`,
        positiveText: '确认恢复',
        negativeText: '取消',
        onPositiveClick: () => resolve('restore'),
        onNegativeClick: () => resolve('cancel'),
        onClose: () => resolve('cancel'),
        onMaskClick: () => resolve('cancel')
      })
    })
    if (action === 'cancel') return
    // 第二步：确认后删除全部并恢复
    const res = await window.api.restoreMetaBackup(true)
    if (res.ok) message.success(`已恢复 ${res.count} 条视频元数据`)
    else message.error(res.error ?? '恢复失败')
  } finally {
    metaBusy.value = false
  }
}

async function onPageSizeChange(value: number): Promise<void> {
  pageSize.value = await window.api.setPageSize(value)
  message.success(`每页将显示 ${value} 个（视频库与元数据同步）`)
}

/** 自定义每页数量（4-100） */
async function onCustomPageSize(value: number | null): Promise<void> {
  if (value === null) return
  const clamped = Math.min(Math.max(value, pageSizeMin), pageSizeMax)
  pageSize.value = await window.api.setPageSize(clamped)
  message.success(`每页将显示 ${clamped} 个（视频库与元数据同步）`)
}

const accentOptions = (Object.entries(ACCENTS) as [AccentKey, (typeof ACCENTS)[AccentKey]][]).map(
  ([key, a]) => ({ key, name: a.name })
)

onMounted(async () => {
  await store.loadInfo()
  const res = await window.api.detectPotPlayer()
  potPlayerPath.value = res.path ?? ''
  pageSize.value = await window.api.getPageSize()
  await refreshServerStatus()
  await loadBackup()
})

async function refreshServerStatus(): Promise<void> {
  serverStatus.value = await window.api.getServerStatus()
  serverPort.value = serverStatus.value.port
}

async function detect(): Promise<void> {
  detecting.value = true
  try {
    const res = await window.api.detectPotPlayer()
    potPlayerPath.value = res.path ?? ''
    if (res.path) message.success(`检测到：${res.path}`)
    else message.error(res.error ?? '未找到 PotPlayer')
  } finally {
    detecting.value = false
  }
}

async function savePotPlayer(): Promise<void> {
  await window.api.savePotPlayerPath(potPlayerPath.value)
  message.success('PotPlayer 路径已保存')
}

async function restartServer(): Promise<void> {
  restarting.value = true
  try {
    const res = await window.api.restartServer(serverPort.value)
    await refreshServerStatus()
    if (res.error) message.error(`服务重启失败：${res.error}`)
    else message.success(`服务已启动：端口 ${res.port}`)
  } finally {
    restarting.value = false
  }
}

async function stopServer(): Promise<void> {
  await window.api.stopServer()
  await refreshServerStatus()
  message.info('服务已停止')
}

/** 在系统浏览器打开 GitHub 主页 */
async function openGithub(): Promise<void> {
  const res = await window.api.openExternal('https://github.com/iop666/VideoManager')
  if (!res.ok) message.error(res.error ?? '打开失败')
}
</script>

<template>
  <div class="page">
    <h2>设置</h2>
    <n-card title="应用信息" size="small" style="max-width: 720px">
      <n-spin :show="store.loading">
        <n-descriptions
          v-if="store.info"
          :column="1"
          label-placement="left"
          bordered
          size="small"
        >
          <n-descriptions-item label="版本">
            {{ store.info.version }}
          </n-descriptions-item>
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
    <n-card title="外观" size="small" style="max-width: 720px; margin-top: 16px">
      <div class="appearance">
        <div class="appearance-row">
          <span class="appearance-label">主题模式</span>
          <n-radio-group :value="theme.mode" @update:value="theme.setMode">
            <n-radio v-for="m in themeModeOptions" :key="m.value" :value="m.value" :label="m.label" />
          </n-radio-group>
        </div>
        <div class="appearance-row">
          <span class="appearance-label">配色</span>
          <div class="swatches">
            <button
              v-for="a in accentOptions"
              :key="a.key"
              class="swatch"
              :class="{ active: theme.accent === a.key }"
              :style="{
                '--swatch': theme.resolved === 'dark' ? ACCENTS[a.key].dark : ACCENTS[a.key].light
              }"
              :title="a.name"
              @click="theme.setAccent(a.key)"
            >
              <span class="swatch-name">{{ a.name }}</span>
            </button>
          </div>
        </div>
      </div>
    </n-card>
    <n-card title="显示数据" size="small" style="max-width: 720px; margin-top: 16px">
      <div class="appearance-row">
        <span class="appearance-label">每页显示</span>
        <n-radio-group
          :value="pageSizeCustom ? null : pageSize"
          :disabled="pageSizeCustom"
          @update:value="onPageSizeChange"
        >
          <n-radio v-for="opt in pageSizeOptions" :key="opt.value" :value="opt.value" :label="opt.label" />
        </n-radio-group>
        <span class="muted-inline">或</span>
        <n-input-number
          :value="pageSize"
          :min="pageSizeMin"
          :max="pageSizeMax"
          style="width: 90px"
          :disabled="false"
          @update:value="onCustomPageSize"
        />
        <span class="muted-inline">自定义（{{ pageSizeMin }}-{{ pageSizeMax }}）</span>
      </div>
      <div v-if="pageSizeCustom" class="muted-inline" style="margin-top: 8px">
        当前使用自定义每页 {{ pageSize }} 个（默认选项已停用）
      </div>
    </n-card>
    <n-card title="PotPlayer 播放器" size="small" style="max-width: 720px; margin-top: 16px">
      <n-space>
        <n-input
          v-model:value="potPlayerPath"
          placeholder="PotPlayerMini64.exe 完整路径（留空自动检测）"
          style="width: 420px"
        />
        <n-button :loading="detecting" @click="detect">
          <template #icon>
            <n-icon><SearchOutline /></n-icon>
          </template>
          检测
        </n-button>
        <n-button type="primary" @click="savePotPlayer">
          <template #icon>
            <n-icon><SaveOutline /></n-icon>
          </template>
          保存
        </n-button>
      </n-space>
      <n-alert type="info" :show-icon="false" style="margin-top: 12px">
        视频详情页「用 PotPlayer 播放」按钮会调用此播放器。自动检测顺序：已保存路径 → 注册表 → 常见安装目录。
      </n-alert>
    </n-card>
    <n-card title="备份与恢复" size="small" style="max-width: 720px; margin-top: 16px">
      <div class="backup-box">
        <div class="appearance-row">
          <span class="appearance-label">备份</span>
          <n-switch :value="backupAuto" @update:value="toggleBackupAuto" />
          <span class="muted-inline">自动备份（元数据保存后自动备份到目录）</span>
          <n-button size="small" :loading="backupBusy" @click="doBackupNow">
            <template #icon>
              <n-icon><ArchiveOutline /></n-icon>
            </template>
            立即备份
          </n-button>
          <n-button size="small" :loading="metaBusy" @click="doRestoreMeta">
            <template #icon>
              <n-icon><CloudUploadOutline /></n-icon>
            </template>
            恢复备份
          </n-button>
        </div>
        <div class="appearance-row" style="margin-top: 10px">
          <span class="appearance-label" style="width: auto">备份目录</span>
          <span class="backup-dir">{{ backupDir || '未设置（请选择目录）' }}</span>
          <n-button size="small" quaternary @click="chooseBackupDir">
            <template #icon>
              <n-icon><FolderOpenOutline /></n-icon>
            </template>
            选择目录
          </n-button>
        </div>
        <div v-if="backupLastAt" class="muted-inline" style="margin-top: 8px">
          最近备份：{{ backupLastAt }} · 可备份 {{ backupCount }} 条视频元数据
        </div>
      </div>
    </n-card>
    <n-card title="局域网服务（Android 端连接）" size="small" style="max-width: 720px; margin-top: 16px">
      <n-space align="center" style="margin-bottom: 12px">
        <n-tag :type="serverStatus?.running ? 'success' : 'error'" size="small">
          {{ serverStatus?.running ? '运行中' : '已停止' }}
        </n-tag>
        <span class="muted-inline">端口：</span>
        <n-input-number
          v-model:value="serverPort"
          :min="1"
          :max="65535"
          style="width: 120px"
        />
        <n-button size="small" :loading="restarting" @click="restartServer">
          <template #icon>
            <n-icon><RefreshOutline /></n-icon>
          </template>
          应用并重启
        </n-button>
        <n-button size="small" type="error" secondary :disabled="!serverStatus?.running" @click="stopServer">
          <template #icon>
            <n-icon><StopOutline /></n-icon>
          </template>
          停止
        </n-button>
      </n-space>
      <n-descriptions v-if="serverStatus" :column="1" label-placement="left" size="small" bordered>
        <n-descriptions-item label="电脑局域网地址">
          {{ serverStatus.address ?? '未知' }}
        </n-descriptions-item>
        <n-descriptions-item label="当前配对码">
          <n-space align="center">
            <span v-if="serverStatus.pairCode" class="pair-code">{{ serverStatus.pairCode }}</span>
            <span v-else class="muted-inline">无（手机端发起配对后生成）</span>
            <n-button size="tiny" @click="refreshServerStatus">刷新</n-button>
          </n-space>
        </n-descriptions-item>
        <n-descriptions-item label="已配对设备">
          <n-space align="center">
            <span>{{ serverStatus.pairedDevices }} 台</span>
            <template v-if="serverStatus.devices.length">
              <n-tag
                v-for="d in serverStatus.devices"
                :key="d.id"
                size="tiny"
                :bordered="false"
              >
                {{ d.name }}
              </n-tag>
            </template>
          </n-space>
        </n-descriptions-item>
      </n-descriptions>
      <n-alert type="info" :show-icon="false" style="margin-top: 12px">
        手机与电脑需在同一局域网（Wi-Fi）。首次连接时手机发起配对，此处会显示 6 位配对码，输入到手机即可。
        首次启动若弹出 Windows 防火墙提示，请选择「允许访问」。接口契约见 <code>docs/api-contract.md</code>。
      </n-alert>
    </n-card>
    <n-card title="关于" size="small" style="max-width: 720px; margin-top: 16px">
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
          <n-button size="tiny" tertiary type="primary" @click="openGithub">打开</n-button>
        </div>
      </n-space>
    </n-card>
  </div>
</template>

<style scoped>
.backup-box {
  border: 1px dashed var(--border-strong);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.backup-dir {
  font-size: 12px;
  color: var(--text-2);
  word-break: break-all;
  flex: 1;
  min-width: 0;
}

.pair-code {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 3px;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.muted-inline {
  color: var(--text-3);
  font-size: 12px;
}

.appearance {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.appearance-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.appearance-label {
  width: 70px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
  flex-shrink: 0;
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

.swatches {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.swatch {
  width: 64px;
  height: 40px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--swatch);
  color: #fff;
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s, box-shadow 0.15s;
}

.swatch:hover {
  transform: translateY(-1px);
}

.swatch.active {
  box-shadow: 0 0 0 2px var(--bg-canvas), 0 0 0 4px var(--swatch);
}

.swatch-name {
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}
</style>
