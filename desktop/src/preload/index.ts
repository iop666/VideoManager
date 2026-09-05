import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppInfo,
  Author,
  BatchRemoveResult,
  BatchVideoPatch,
  BatchVideoResult,
  Category,
  ConvertFileInfo,
  ConvertItem,
  ConvertOptions,
  DuplicateGroup,
  ImportFolder,
  MetaSortConfig,
  PlayerDetectResult,
  PlayerPlayResult,
  RenamePreviewItem,
  RenameResult,
  RenameRules,
  RestoreDiffItem,
  RestoreDiffKind,
  RestoreExecuteResult,
  RestoreLog,
  RestoreMode,
  RestorePlanResult,
  ServerStatus,
  StatsSummary,
  Tag,
  Task,
  TaskActionResult,
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
  /** 单任务控制：取消 / 暂停 / 继续 / 重试 / 删除 */
  cancelTask: (id: number): Promise<TaskActionResult> => ipcRenderer.invoke('tasks:cancel', id),
  pauseTask: (id: number): Promise<TaskActionResult> => ipcRenderer.invoke('tasks:pause', id),
  resumeTask: (id: number): Promise<TaskActionResult> => ipcRenderer.invoke('tasks:resume', id),
  retryTask: (id: number): Promise<TaskActionResult> => ipcRenderer.invoke('tasks:retry', id),
  deleteTask: (id: number): Promise<TaskActionResult> => ipcRenderer.invoke('tasks:delete', id),
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
  /** 关键帧截图 base64 data URL（Keyframe_<sha256>_NN.jpg） */
  getKeyframe: (name: string): Promise<string | null> => ipcRenderer.invoke('keyframe:get', name),

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

  // ---- 批量操作（元数据页多选） ----
  batchUpdateVideos: (ids: number[], patch: BatchVideoPatch): Promise<BatchVideoResult> =>
    ipcRenderer.invoke('videos:batch-fields', ids, patch),
  /** 追加标签（与已有标签合并去重） */
  batchAppendVideoTags: (ids: number[], tagNames: string[]): Promise<BatchVideoResult> =>
    ipcRenderer.invoke('videos:batch-tags', ids, tagNames),
  /** 批量删除（deleteFile=true 时同时删除真实本地文件；封面/关键帧走 GC） */
  batchRemoveVideos: (ids: number[], deleteFile: boolean): Promise<BatchRemoveResult> =>
    ipcRenderer.invoke('videos:batch-remove', ids, deleteFile),

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
  /** 手动选择播放器 exe（返回 null 表示取消） */
  selectPlayerFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:select-player'),
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
  getCoverMode: (): Promise<string> => ipcRenderer.invoke('settings:cover-mode'),
  setCoverMode: (value: 'landscape' | 'normal'): Promise<string> =>
    ipcRenderer.invoke('settings:cover-mode', value),
  /** 元数据编辑页下拉列表排序配置 */
  getMetaEditSort: (): Promise<MetaSortConfig> => ipcRenderer.invoke('settings:meta-edit-sort'),
  setMetaEditSort: (cfg: MetaSortConfig): Promise<MetaSortConfig> =>
    ipcRenderer.invoke('settings:meta-edit-sort', cfg),
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
  /** 恢复向导第 1 步：选择备份 → 完整性校验 + 差异分析（只读，不写盘） */
  planRestoreBackup: (): Promise<RestorePlanResult> => ipcRenderer.invoke('settings:meta-restore-plan'),
  /** 差异明细（kind 过滤，省略返回全部） */
  getRestoreDiff: (kind?: RestoreDiffKind | null): Promise<RestoreDiffItem[]> =>
    ipcRenderer.invoke('settings:meta-restore-diff', kind ?? null),
  /** 执行恢复（full / backup-first / local-first / missing-only），自动快照后可回滚 */
  executeRestoreBackup: (mode: RestoreMode): Promise<RestoreExecuteResult> =>
    ipcRenderer.invoke('settings:meta-restore-execute', mode),
  /** 最近恢复/回滚日志 */
  listRestoreLogs: (limit?: number): Promise<RestoreLog[]> =>
    ipcRenderer.invoke('settings:meta-restore-logs', limit),
  /** 回滚到某次恢复前的自动快照（参数为恢复日志 id） */
  rollbackRestoreSnapshot: (logId: number): Promise<{ ok: boolean; error?: string; gcRemoved?: number }> =>
    ipcRenderer.invoke('settings:meta-restore-rollback', logId),

  // ---- 外部链接 ----
  openExternal: (url: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('shell:open-external', url)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
