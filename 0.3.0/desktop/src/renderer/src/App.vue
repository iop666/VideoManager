<script setup lang="ts">
import { computed, h, onMounted, ref, watch, type Component } from 'vue'
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
  ServerOutline,
  MenuOutline
} from '@vicons/ionicons5'
import { ACCENTS, buildThemeOverrides } from './theme'

const route = useRoute()
const router = useRouter()
const themeStore = useThemeStore()

const importStore = useImportStore()

// 侧边栏收起/展开（默认展开）
const siderCollapsed = ref(false)
function toggleSider(): void {
  siderCollapsed.value = !siderCollapsed.value
}

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
  {
    label: '媒体',
    key: 'group-media',
    type: 'group',
    children: [
      { label: '视频库', key: '/library', icon: renderIcon(VideocamOutline) },
      { label: '元数据', key: '/metadata', icon: renderIcon(ServerOutline) },
      { label: '统计管理', key: '/stats', icon: renderIcon(BarChartOutline) }
    ]
  },
  {
    label: '工具',
    key: 'group-tools',
    type: 'group',
    children: [
      { label: '导入视频', key: '/import', icon: renderIcon(FolderOpenOutline) },
      { label: '转换格式', key: '/convert', icon: renderIcon(GitCompareOutline) },
      { label: '重命名', key: '/rename', icon: renderIcon(TextOutline) }
    ]
  },
  {
    label: '系统',
    key: 'group-system',
    type: 'group',
    children: [
      { label: '任务', key: '/tasks', icon: renderIcon(ListOutline) },
      { label: '设置', key: '/settings', icon: renderIcon(SettingsOutline) }
    ]
  }
]

/** 侧边栏扁平导航数据（用于收起时的自定义紧凑渲染） */
const navGroups = [
  {
    label: '媒体',
    items: [
      { label: '视频库', key: '/library', icon: VideocamOutline },
      { label: '元数据', key: '/metadata', icon: ServerOutline },
      { label: '统计管理', key: '/stats', icon: BarChartOutline }
    ]
  },
  {
    label: '工具',
    items: [
      { label: '导入视频', key: '/import', icon: FolderOpenOutline },
      { label: '转换格式', key: '/convert', icon: GitCompareOutline },
      { label: '重命名', key: '/rename', icon: TextOutline }
    ]
  },
  {
    label: '系统',
    items: [
      { label: '任务', key: '/tasks', icon: ListOutline },
      { label: '设置', key: '/settings', icon: SettingsOutline }
    ]
  }
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
          <div class="app-shell">
            <aside
              class="app-sider"
              :class="{ 'app-sider-collapsed': siderCollapsed }"
            >
              <div class="brand" :class="{ 'brand-collapsed': siderCollapsed }">
                <div class="brand-logo">▶</div>
                <div v-if="!siderCollapsed" class="brand-text">
                  <div class="brand-name">VideoManager</div>
                  <div class="brand-sub">本地视频管理</div>
                </div>
              </div>
              <div class="sider-menu">
                <n-menu
                  v-if="!siderCollapsed"
                  :options="menuOptions"
                  :value="activeKey"
                  @update:value="handleMenuSelect"
                />
                <!-- 收起模式：只显示分组标题 + 图标 -->
                <div v-else class="sider-collapsed-menu">
                  <div v-for="group in navGroups" :key="group.label" class="col-group">
                    <div class="col-group-title">{{ group.label }}</div>
                    <button
                      v-for="item in group.items"
                      :key="item.key"
                      class="col-item"
                      :class="{ active: activeKey === item.key }"
                      :title="item.label"
                      @click="handleMenuSelect(item.key)"
                    >
                      <component :is="item.icon" class="col-item-icon" :size="18" />
                    </button>
                  </div>
                </div>
              </div>
              <div class="sider-footer">
                <button
                  class="sider-toggle"
                  :class="{ 'sider-toggle-footer-collapsed': siderCollapsed }"
                  :title="siderCollapsed ? '展开侧边栏' : '收起侧边栏'"
                  @click="toggleSider"
                >
                  <MenuOutline class="sider-toggle-icon" :size="18" />
                </button>
                <span v-if="!siderCollapsed" class="sider-status"><span class="dot" /> 服务已启动</span>
              </div>
            </aside>
            <n-layout>
              <n-layout-header bordered class="header">
                <span class="header-title">{{ (route.meta.title as string) ?? '' }}</span>
              </n-layout-header>
              <n-layout-content :native-scrollbar="false" class="content">
                <router-view />
              </n-layout-content>
            </n-layout>
          </div>
        </div>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style>
.app-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.app-sider {
  width: 208px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  position: relative;
  transition: width 0.3s var(--n-bezier, ease);
  overflow: hidden;
}

.app-sider-collapsed {
  width: 64px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 16px 14px;
  position: relative;
  width: 100%;
  box-sizing: border-box;
  overflow: hidden;
}

.brand-collapsed {
  justify-content: center;
  padding: 18px 0 14px;
  flex-direction: column;
  gap: 8px;
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
  flex-shrink: 0;
}

.brand-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.sider-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  flex-shrink: 0;
}

.sider-toggle:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}

.sider-toggle-icon {
  display: block;
  width: 18px;
  height: 18px;
}

.sider-toggle-footer-collapsed {
  margin: 0 auto;
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

.sider-collapsed-menu {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0 6px;
}

.col-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.col-group-title {
  font-size: 10px;
  color: var(--text-3);
  letter-spacing: 0.5px;
  margin-bottom: 2px;
}

.col-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  font-size: 18px;
}

.col-item:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}

.col-item.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.col-item-icon {
  display: block;
  width: 18px;
  height: 18px;
}

.sider-footer {
  position: absolute;
  bottom: 16px;
  left: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-3);
}

.sider-status {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  white-space: nowrap;
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
