<script setup lang="ts">
import { computed, h, onMounted, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useImportStore } from './stores/import'
import { useThemeStore } from './stores/theme'
import {
  NConfigProvider,
  NDialogProvider,
  NMessageProvider,
  NLayout,
  NLayoutSider,
  NLayoutHeader,
  NLayoutContent,
  NMenu,
  darkTheme,
  lightTheme,
  zhCN,
  dateZhCN,
  type MenuOption
} from 'naive-ui'
import {
  VideocamOutline,
  FolderOpenOutline,
  GitCompareOutline,
  TextOutline,
  ListOutline,
  SettingsOutline,
  BarChartOutline,
  ServerOutline
} from '@vicons/ionicons5'
import { ACCENTS, buildThemeOverrides } from './theme'

const route = useRoute()
const router = useRouter()
const themeStore = useThemeStore()

const importStore = useImportStore()

// data-theme 必须设在 html 元素：CSS 变量定义在 :root[data-theme]，body 背景等依赖它
function applyThemeAttr(): void {
  document.documentElement.dataset.theme = themeStore.resolved
}

applyThemeAttr()

watch(
  () => themeStore.resolved,
  () => applyThemeAttr()
)

onMounted(() => {
  importStore.subscribe()
  void importStore.loadFolders()
  void importStore.loadTasks()
  // 同步主题到系统 chrome（Windows 标题栏颜色）
  void window.api.setThemeSource(themeStore.mode)
})

watch(
  () => themeStore.mode,
  (m) => {
    void window.api.setThemeSource(m)
  }
)

function renderIcon(icon: Component): () => ReturnType<typeof h> {
  return () => h(icon)
}

const menuOptions: MenuOption[] = [
  { label: '视频库', key: '/library', icon: renderIcon(VideocamOutline) },
  { label: '元数据', key: '/metadata', icon: renderIcon(ServerOutline) },
  { label: '统计', key: '/stats', icon: renderIcon(BarChartOutline) },
  { label: '导入', key: '/import', icon: renderIcon(FolderOpenOutline) },
  { label: '转换', key: '/convert', icon: renderIcon(GitCompareOutline) },
  { label: '重命名', key: '/rename', icon: renderIcon(TextOutline) },
  { label: '任务', key: '/tasks', icon: renderIcon(ListOutline) },
  { label: '设置', key: '/settings', icon: renderIcon(SettingsOutline) }
]

const activeKey = computed(() => route.path)

function handleMenuSelect(key: string): void {
  router.push(key)
}

const currentTheme = computed(() =>
  themeStore.resolved === 'dark' ? darkTheme : lightTheme
)

const overrides = computed(() =>
  buildThemeOverrides(themeStore.resolved, themeStore.accent)
)

const accentCss = computed(() => {
  const a = ACCENTS[themeStore.accent] ?? ACCENTS.sky
  return themeStore.resolved === 'dark' ? a.dark : a.light
})

const accentSoftCss = computed(() => {
  const a = ACCENTS[themeStore.accent] ?? ACCENTS.sky
  const hex = themeStore.resolved === 'dark' ? a.dark : a.light
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${themeStore.resolved === 'dark' ? 0.1 : 0.08})`
})
</script>

<template>
  <n-config-provider
    :theme="currentTheme"
    :theme-overrides="overrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
  >
    <n-message-provider>
      <n-dialog-provider>
        <div
          class="app-root"
          :style="{ '--accent': accentCss, '--accent-soft': accentSoftCss }"
        >
          <n-layout has-sider style="height: 100vh">
            <n-layout-sider bordered :width="208" :native-scrollbar="false" class="app-sider">
              <div class="brand">
                <div class="brand-logo">▶</div>
                <div class="brand-text">
                  <div class="brand-name">VideoManager</div>
                  <div class="brand-sub">本地视频管理</div>
                </div>
              </div>
              <div class="sider-menu">
                <n-menu :options="menuOptions" :value="activeKey" @update:value="handleMenuSelect" />
              </div>
              <div class="sider-footer">
                <span class="dot" /> 服务已启动
              </div>
            </n-layout-sider>
            <n-layout>
              <n-layout-header bordered class="header">
                <span class="header-title">{{ (route.meta.title as string) ?? '' }}</span>
              </n-layout-header>
              <n-layout-content :native-scrollbar="false" class="content">
                <router-view />
              </n-layout-content>
            </n-layout>
          </n-layout>
        </div>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style>
.app-sider {
  border-right: 1px solid var(--border) !important;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 16px 14px;
}

.brand-logo {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--accent), var(--accent));
  color: #fff;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px var(--accent-soft);
}

.brand-name {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: var(--text-1);
  line-height: 1.2;
}

.brand-sub {
  font-size: 11px;
  color: var(--text-3);
  margin-top: 2px;
}

.sider-menu {
  padding: 4px 10px;
}

.sider-footer {
  position: absolute;
  bottom: 16px;
  left: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-3);
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 24px;
  background: var(--bg-card) !important;
  border-bottom: 1px solid var(--border) !important;
}

.header-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
}

.content {
  height: calc(100vh - 52px);
}

/* 小米风格细滚动条 */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--border-strong);
  border-radius: 5px;
  border: 2px solid var(--bg-canvas);
}
::-webkit-scrollbar-thumb:hover {
  background: var(--text-disabled);
}

/* focus 可见性：accent outline */
button:focus-visible,
a:focus-visible,
input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
