import { createRouter, createWebHashHistory } from 'vue-router'
import LibraryView from '../views/LibraryView.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/library' },
    { path: '/library', name: 'library', component: LibraryView, meta: { title: '视频库' } },
    {
      path: '/metadata',
      name: 'metadata',
      component: () => import('../views/MetadataView.vue'),
      meta: { title: '元数据' }
    },
    {
      path: '/stats',
      name: 'stats',
      component: () => import('../views/StatsView.vue'),
      meta: { title: '统计管理' }
    },
    {
      path: '/import',
      name: 'import',
      component: () => import('../views/ImportView.vue'),
      meta: { title: '导入视频' }
    },
    {
      path: '/convert',
      name: 'convert',
      component: () => import('../views/ConvertView.vue'),
      meta: { title: '转换格式' }
    },
    {
      path: '/rename',
      name: 'rename',
      component: () => import('../views/RenameView.vue'),
      meta: { title: '重命名' }
    },
    {
      path: '/tasks',
      name: 'tasks',
      component: () => import('../views/TasksView.vue'),
      meta: { title: '任务' }
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/SettingsView.vue'),
      meta: { title: '设置' }
    }
  ]
})

export default router
