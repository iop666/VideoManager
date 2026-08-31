import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppInfo,
  Author,
  Category,
  ConvertFileInfo,
  ConvertItem,
  ConvertOptions,
  DuplicateGroup,
  ImportFolder,
  PlayerDetectResult,
  PlayerPlayResult,
  RenamePreviewItem,
  RenameResult,
  RenameRules,
  ServerStatus,
  StatsSummary,
  Tag,
  Task,
  VideoListQuery,
  VideoListResult,
  VideoListItem,
  VideoUpdateFields
} from '../shared/types'

const api = {
  // ---- 应用信息 ----
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:get-info'),
  /** 同步应用主题到系统 chrome（标题栏颜色） */
  setThemeSource: (mode: string): Promise<void> => ipcRenderer.invoke('theme:set-source', mode),

  // ---- 导入文件夹 / 任务 ----
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:select-folder'),
  listImportFolders: (): Promise<ImportFolder[]> => ipcRenderer.invoke('folders:list'),
  addImportFolder: (opts: { path: string; recursive?: boolean }): Promise<ImportFolder | { error: string }> =>
    ipcRenderer.invoke('folders:add', opts),
  removeImportFolder: (id: number): Promise<void> => ipcRenderer.invoke('folders:remove', id),
  scanImportFolder: (id: number): Promise<number> => ipcRenderer.invoke('folders:scan', id),
  listTasks: (): Promise<Task[]> => ipcRenderer.invoke('tasks:list'),
  clearTasks: (): Promise<{ ok: boolean; count: number }> => ipcRenderer.invoke('tasks:clear'),
  onTasksChanged: (cb: (tasks: Task[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, tasks: Task[]): void => cb(tasks)
    ipcRenderer.on('tasks:changed', listener)
    return () => ipcRenderer.removeListener('tasks:changed', listener)
  },

  // ---- 视频列表 / 详情 ----
  listVideos: (query: VideoListQuery): Promise<VideoListResult> => ipcRenderer.invoke('videos:list', query),
  getVideo: (id: number): Promise<VideoListItem | null> => ipcRenderer.invoke('videos:get', id),
  updateVideo: (id: number, fields: VideoUpdateFields): Promise<void> =>
    ipcRenderer.invoke('videos:update', id, fields),
  setVideoTags: (id: number, tagNames: string[]): Promise<void> =>
    ipcRenderer.invoke('videos:set-tags', id, tagNames),
  recordPlay: (id: number): Promise<void> => ipcRenderer.invoke('videos:record-play', id),
  findDuplicates: (): Promise<DuplicateGroup[]> => ipcRenderer.invoke('videos:duplicates'),
  /** 缩略图 base64 data URL（内存缓存由渲染进程管理） */
  getThumbnail: (id: number): Promise<string | null> => ipcRenderer.invoke('thumbnail:get', id),

  // ---- 分类 / 标签 ----
  listCategories: (): Promise<Category[]> => ipcRenderer.invoke('categories:list'),
  addCategory: (name: string, color?: string | null): Promise<Category | { error: string }> =>
    ipcRenderer.invoke('categories:add', name, null, color),
  updateCategory: (id: number, name: string, color?: string | null): Promise<{ error?: string }> =>
    ipcRenderer.invoke('categories:update', id, name, color),
  removeCategory: (id: number): Promise<void> => ipcRenderer.invoke('categories:remove', id),
  moveCategory: (id: number, dir: 'up' | 'down'): Promise<void> =>
    ipcRenderer.invoke('categories:move', id, dir),
  listTags: (): Promise<Tag[]> => ipcRenderer.invoke('tags:list'),
  addTag: (name: string, color?: string | null): Promise<Tag | { error: string }> =>
    ipcRenderer.invoke('tags:add', name, color),
  updateTag: (id: number, name: string, color?: string | null): Promise<{ error?: string }> =>
    ipcRenderer.invoke('tags:update', id, name, color),
  removeTag: (id: number): Promise<void> => ipcRenderer.invoke('tags:remove', id),
  listAuthors: (): Promise<Author[]> => ipcRenderer.invoke('authors:list'),
  addAuthor: (name: string, color?: string | null): Promise<Author | { error: string }> =>
    ipcRenderer.invoke('authors:add', name, color),
  updateAuthor: (id: number, name: string, color?: string | null): Promise<{ error?: string }> =>
    ipcRenderer.invoke('authors:update', id, name, color),
  removeAuthor: (id: number): Promise<void> => ipcRenderer.invoke('authors:remove', id),
  removeVideo: (id: number, deleteFile: boolean): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('videos:remove', id, deleteFile),
  clearAllVideos: (): Promise<{ ok: boolean; count: number }> =>
    ipcRenderer.invoke('videos:clear-all'),

  // ---- 批量重命名 ----
  renamePreview: (
    videos: Array<{ id?: number; filePath: string; title: string }>,
    rules: RenameRules
  ): Promise<RenamePreviewItem[]> => ipcRenderer.invoke('rename:preview', videos, rules),
  renameApply: (plan: RenamePreviewItem[]): Promise<RenameResult> =>
    ipcRenderer.invoke('rename:apply', plan),
  renameUndo: (): Promise<RenameResult> => ipcRenderer.invoke('rename:undo'),
  renameUndoAvailable: (): Promise<boolean> => ipcRenderer.invoke('rename:undo-available'),
  /** 批量修改扩展名（类似 DOS ren *.txt *.doc） */
  renameChangeExtension: (
    folder: string,
    fromExt: string,
    toExt: string
  ): Promise<{ changed: number; failed: { path: string; error: string }[]; undoAvailable: boolean }> =>
    ipcRenderer.invoke('rename:change-extension', folder, fromExt, toExt),
  renameUndoExtension: (): Promise<{ changed: number; failed: { path: string; error: string }[]; undoAvailable: boolean }> =>
    ipcRenderer.invoke('rename:undo-extension'),

  // ---- PotPlayer ----
  detectPotPlayer: (): Promise<PlayerDetectResult> => ipcRenderer.invoke('player:detect'),
  playWithPotPlayer: (videoPath: string): Promise<PlayerPlayResult> =>
    ipcRenderer.invoke('player:play', videoPath),
  savePotPlayerPath: (path: string): Promise<void> => ipcRenderer.invoke('player:save-path', path),

  // ---- 格式转换 ----
  selectVideoFiles: (): Promise<string[] | null> => ipcRenderer.invoke('dialog:select-files'),
  inspectConvertFiles: (paths: string[]): Promise<ConvertFileInfo[]> =>
    ipcRenderer.invoke('convert:inspect', paths),
  collectFolderVideos: (folder: string): Promise<string[]> =>
    ipcRenderer.invoke('convert:collect-folder', folder),
  convertStart: (
    items: ConvertItem[],
    options: Omit<ConvertOptions, 'filePath' | 'videoId'>
  ): Promise<number> => ipcRenderer.invoke('convert:start', items, options),
  getConvertOutputDir: (): Promise<string> => ipcRenderer.invoke('settings:convert-output-dir', null),
  setConvertOutputDir: (dir: string): Promise<string> =>
    ipcRenderer.invoke('settings:convert-output-dir', dir),
  getPageSize: (): Promise<number> => ipcRenderer.invoke('settings:page-size'),
  setPageSize: (value: number): Promise<number> => ipcRenderer.invoke('settings:page-size', value),
  getMetaBackup: (): Promise<{ dir: string; auto: boolean; count: number; lastBackupAt: string | null }> =>
    ipcRenderer.invoke('settings:meta-backup'),
  setMetaBackup: (opts: { dir?: string | null; auto?: boolean | null }): Promise<{ dir: string; auto: boolean; count: number; lastBackupAt: string | null }> =>
    ipcRenderer.invoke('settings:meta-backup', opts),

  // ---- 局域网服务 ----
  getServerStatus: (): Promise<ServerStatus> => ipcRenderer.invoke('server:status'),
  restartServer: (port?: number): Promise<{ port: number; error: string | null }> =>
    ipcRenderer.invoke('server:restart', port),
  stopServer: (): Promise<void> => ipcRenderer.invoke('server:stop'),

  // ---- 统计 ----
  getStatsSummary: (): Promise<StatsSummary> => ipcRenderer.invoke('stats:summary'),

  // ---- 备份 / 恢复 ----
  backupMetaNow: (): Promise<{ ok: boolean; path?: string; count?: number; error?: string }> =>
    ipcRenderer.invoke('settings:meta-backup-now'),
  /** 恢复备份：不传 confirm=选文件+解析统计 total；confirm=true=删除全部数据后恢复 */
  restoreMetaBackup: (confirm?: boolean): Promise<{ ok: boolean; count?: number; total?: number; error?: string }> =>
    ipcRenderer.invoke('settings:meta-restore', confirm ?? null),

  // ---- 外部链接 ----
  openExternal: (url: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('shell:open-external', url)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
