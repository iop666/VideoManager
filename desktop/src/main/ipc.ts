import { app, dialog, ipcMain, BrowserWindow, nativeTheme, shell } from 'electron'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { getDb, getDbPath, getDbStats } from './db'
import { resolveFfmpegPaths } from './services/ffmpeg'
import { listTasks, TaskQueue } from './services/taskQueue'
import { listVideos, getVideoDetail, updateVideo, setVideoTags, recordPlay, findDuplicates, batchAppendTags, batchRemoveVideos, batchUpdateVideos } from './services/videos'
import {
  addAuthor,
  addCategory,
  addTag,
  listAuthors,
  listCategories,
  moveCategory,
  removeAuthor,
  removeCategory,
  updateAuthor,
  updateCategory,
  updateTag,
  listTags,
  removeTag
} from './services/meta'
import { applyRename, buildRenamePreview, changeExtension, isUndoAvailable, undoExtensionChange, undoRename } from './services/rename'
import { detectPotPlayer, playWithPotPlayer, savePotPlayerPath } from './services/potplayer'
import { getServerStatus, startHttpServer, stopHttpServer } from './services/httpServer'
import { getStatsSummary } from './services/stats'
import { collectVideoFilesInFolder, inspectFiles } from './services/converter'
import { buildExportZip } from './services/metaZip'
import { keyframeDir } from './services/keyframes'
import {
  buildDiff,
  executeRestore,
  listRestoreLogs,
  loadZipManifest,
  rollbackByLogId,
  sweepOrphanAssets,
  type ZipManifest
} from './services/restore'
import { getSetting, setSetting } from './db'
import { PAGE_SIZE_MAX, PAGE_SIZE_MIN } from '../shared/types'
import type {
  AppInfo,
  Author,
  BatchRemoveResult,
  BatchVideoPatch,
  BatchVideoResult,
  TaskActionResult,
  Category,
  ConvertFileInfo,
  ConvertItem,
  ConvertOptions,
  DuplicateGroup,
  FfmpegInfo,
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
  RestoreSummary,
  ServerStatus,
  StatsSummary,
  Tag,
  Task,
  VideoListQuery,
  VideoListResult,
  VideoListItem,
  VideoUpdateFields
} from '../shared/types'

/**
 * 解析应用版本号：
 *  - 稳定运行模式（electron out/main/index.js）下 app.getVersion() 返回 Electron 版本(44.x)
 *  - 打包后 app.getVersion() 正确（electron-builder 写入）
 *  - 优先读 package.json 的 version 字段（app.getAppPath() 指向项目根/asar 内）
 */
function resolveAppVersion(): string {
  try {
    const pkgPath = join(app.getAppPath(), 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
      if (pkg.version && /^\d+\.\d+\.\d+/.test(pkg.version)) return pkg.version
    }
  } catch {
    /* 忽略，回退 */
  }
  const v = app.getVersion()
  // 排除 Electron 自身版本（44.x 等非项目版本）
  if (v && !/^44\./.test(v)) return v
  return '0.6.0'
}

/** 北京时间文件名时间戳（YYYY-MM-DDTHH-mm-ss，东八区） */
function beijingStamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  // 用本地时区格式化（系统已设为北京时间则直接本地）
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

/** 注册主进程 IPC 处理器（渲染进程通过 preload 的 window.api 调用） */
export function registerIpcHandlers(taskQueue: TaskQueue): void {
  /** 若开启自动备份，静默备份元数据到备份目录（失败不影响主流程） */
  const maybeAutoBackup = (): void => {
    try {
      if (getSetting('meta_backup_auto') !== '1') return
      const dir = getSetting('meta_backup_dir')
      if (!dir) return
      void (async () => {
        const { mkdirSync, readdirSync, rmSync, writeFileSync } = await import('node:fs')
        const { join } = await import('node:path')
        mkdirSync(dir, { recursive: true })
        const { zip } = buildExportZip()
        const stamp = beijingStamp()
        const file = join(dir, `videomanager-backup-${stamp}.zip`)
        writeFileSync(file, Buffer.from(zip))
        const files = readdirSync(dir).filter((f) => f.startsWith('videomanager-backup-')).sort()
        while (files.length > 30) {
          const old = files.shift()!
          try {
            rmSync(join(dir, old), { force: true })
          } catch {
            /* ignore */
          }
        }
        setSetting('meta_backup_last_at', new Date().toLocaleString('zh-CN'))
      })()
    } catch {
      /* 自动备份失败不影响主流程 */
    }
  }

  ipcMain.handle('app:get-info', (): AppInfo => {
    let ffmpeg: FfmpegInfo
    try {
      const paths = resolveFfmpegPaths(app.getAppPath())
      ffmpeg = { ffmpeg: paths.ffmpeg, ffprobe: paths.ffprobe, error: null }
    } catch (err) {
      ffmpeg = { ffmpeg: null, ffprobe: null, error: err instanceof Error ? err.message : String(err) }
    }
    return {
      version: resolveAppVersion(),
      versions: {
        electron: process.versions.electron ?? '',
        node: process.versions.node,
        chrome: process.versions.chrome ?? ''
      },
      dbPath: getDbPath(),
      dbStats: getDbStats(),
      ffmpeg
    }
  })

  /** 应用主题源：同步 Windows 系统标题栏/滚动条等 chrome 到应用主题 */
  ipcMain.handle('theme:set-source', (_e, mode: string): void => {
    nativeTheme.themeSource = mode === 'auto' ? 'system' : (mode as 'light' | 'dark')
  })

  ipcMain.handle('dialog:select-folder', async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })

  ipcMain.handle('folders:list', (): ImportFolder[] => {
    return getDb().prepare('SELECT * FROM import_folders ORDER BY id').all() as unknown as ImportFolder[]
  })

  ipcMain.handle(
    'folders:add',
    (_e, opts: { path: string; recursive?: boolean }): ImportFolder | { error: string } => {
      const p = opts.path.trim()
      if (!p) return { error: '路径不能为空' }
      try {
        const res = getDb()
          .prepare('INSERT INTO import_folders (path, recursive) VALUES (?, ?)')
          .run(p, opts.recursive ? 1 : 0)
        return getDb()
          .prepare('SELECT * FROM import_folders WHERE id = ?')
          .get(Number(res.lastInsertRowid)) as unknown as ImportFolder
      } catch {
        const existing = getDb().prepare('SELECT * FROM import_folders WHERE path = ?').get(p) as
          | ImportFolder
          | undefined
        if (existing) return existing
        return { error: '添加失败' }
      }
    }
  )

  ipcMain.handle('folders:remove', (_e, id: number): void => {
    getDb().prepare('DELETE FROM import_folders WHERE id = ?').run(id)
  })

  ipcMain.handle('folders:scan', (_e, id: number): number => {
    const folder = getDb().prepare('SELECT * FROM import_folders WHERE id = ?').get(id) as
      | ImportFolder
      | undefined
    if (!folder) throw new Error('导入文件夹不存在')
    return taskQueue.enqueue('import', {
      folderId: folder.id,
      folderPath: folder.path,
      recursive: folder.recursive === 1
    })
  })

  ipcMain.handle('tasks:list', (): Task[] => listTasks(100))

  /** 单任务操作统一包装：捕获异常返回 { ok, error } */
  const runTaskAction = (
    fn: (id: number) => { ok: boolean; error?: string },
    id: number
  ): TaskActionResult => {
    try {
      return fn(id)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  ipcMain.handle('tasks:cancel', (_e, id: number): TaskActionResult =>
    runTaskAction((x) => taskQueue.cancel(x), id)
  )
  ipcMain.handle('tasks:pause', (_e, id: number): TaskActionResult =>
    runTaskAction((x) => taskQueue.pause(x), id)
  )
  ipcMain.handle('tasks:resume', (_e, id: number): TaskActionResult =>
    runTaskAction((x) => taskQueue.resume(x), id)
  )
  ipcMain.handle('tasks:retry', (_e, id: number): TaskActionResult =>
    runTaskAction((x) => taskQueue.retry(x), id)
  )
  ipcMain.handle('tasks:delete', (_e, id: number): TaskActionResult =>
    runTaskAction((x) => taskQueue.deleteTask(x), id)
  )

  /** 清空任务历史（仅已完成/失败/已取消；进行中与排队中不受影响） */
  ipcMain.handle('tasks:clear', (): { ok: boolean; count: number } => taskQueue.clearFinished())

  // ============ M3：视频列表与详情 ============

  ipcMain.handle('videos:list', (_e, query: VideoListQuery): VideoListResult => listVideos(query))

  ipcMain.handle('videos:get', (_e, id: number): VideoListItem | null => getVideoDetail(id))

  ipcMain.handle('videos:update', (_e, id: number, fields: VideoUpdateFields): void => {
    updateVideo(id, fields)
    maybeAutoBackup()
  })

  ipcMain.handle('videos:set-tags', (_e, id: number, tagNames: string[]): void => {
    setVideoTags(id, tagNames)
    maybeAutoBackup()
  })

  // ============ 批量操作（元数据页多选） ============

  ipcMain.handle(
    'videos:batch-fields',
    (_e, ids: number[], patch: BatchVideoPatch): BatchVideoResult => {
      try {
        const res = batchUpdateVideos(ids, patch)
        if (res.ok) maybeAutoBackup()
        return res
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), updated: 0 }
      }
    }
  )

  ipcMain.handle(
    'videos:batch-tags',
    (_e, ids: number[], tagNames: string[]): BatchVideoResult => {
      const res = batchAppendTags(ids, tagNames)
      if (res.ok) maybeAutoBackup()
      return res
    }
  )

  ipcMain.handle(
    'videos:batch-remove',
    (_e, ids: number[], deleteFile: boolean): BatchRemoveResult => {
      const res = batchRemoveVideos(ids, deleteFile)
      if (res.ok) {
        try {
          sweepOrphanAssets()
        } catch {
          /* GC 失败不影响 */
        }
      }
      return res
    }
  )

  /** 记录一次播放（播放次数 +1） */
  ipcMain.handle('videos:record-play', (_e, id: number): void => {
    recordPlay(id)
  })

  /** 按 SHA-256 审查重复视频 */
  ipcMain.handle('videos:duplicates', (): DuplicateGroup[] => findDuplicates())

  /** 读取缩略图为 base64 data URL（渲染进程 file:// 直读在 dev 模式被 Chromium 拦截） */
  ipcMain.handle('thumbnail:get', (_e, id: number): string | null => {
    const row = getDb()
      .prepare('SELECT thumbnail_path FROM videos WHERE id = ?')
      .get(id) as { thumbnail_path: string | null } | undefined
    if (!row?.thumbnail_path) return null
    try {
      const data = readFileSync(row.thumbnail_path)
      return `data:image/jpeg;base64,${data.toString('base64')}`
    } catch {
      return null
    }
  })

  /** 读取单张关键帧截图为 base64 data URL（Keyframe_<sha256>_NN.jpg） */
  ipcMain.handle('keyframe:get', (_e, name: string): string | null => {
    try {
      const file = join(keyframeDir(), name)
      if (!existsSync(file)) return null
      const data = readFileSync(file)
      return `data:image/jpeg;base64,${data.toString('base64')}`
    } catch {
      return null
    }
  })

  /** 在资源管理器中定位文件（已按用户要求移除路径跳转功能，IPC 保留以便后续启用） */
  ipcMain.handle('shell:show-item', (_e, filePath: string): { ok: boolean; error?: string } => {
    try {
      if (!filePath) return { ok: false, error: '路径为空' }
      if (existsSync(filePath)) {
        shell.showItemInFolder(filePath)
        return { ok: true }
      }
      // 文件不存在：尝试打开其所在目录
      const { dirname } = require('node:path') as typeof import('node:path')
      const dir = dirname(filePath)
      if (existsSync(dir)) {
        shell.openPath(dir)
        return { ok: true }
      }
      return { ok: false, error: '路径不存在' }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /** 在系统默认浏览器中打开外部链接（仅允许 http/https，防止任意协议注入） */
  ipcMain.handle('shell:open-external', (_e, url: string): { ok: boolean; error?: string } => {
    try {
      const u = String(url ?? '').trim()
      if (!/^https?:\/\//i.test(u)) return { ok: false, error: '仅支持 http/https 链接' }
      void shell.openExternal(u)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ============ M4：分类 / 标签 ============

  ipcMain.handle('categories:list', (): Category[] => listCategories())

  ipcMain.handle(
    'categories:add',
    (_e, name: string, parentId?: number | null, color?: string | null): Category | { error: string } =>
      addCategory(name, parentId, color)
  )

  ipcMain.handle(
    'categories:update',
    (_e, id: number, name: string, color?: string | null): { error?: string } =>
      updateCategory(id, name, color)
  )

  ipcMain.handle('categories:remove', (_e, id: number): void => removeCategory(id))

  ipcMain.handle('categories:move', (_e, id: number, dir: 'up' | 'down'): void =>
    moveCategory(id, dir)
  )

  ipcMain.handle('tags:list', (): Tag[] => listTags())

  ipcMain.handle('tags:add', (_e, name: string, color?: string | null): Tag | { error: string } =>
    addTag(name, color)
  )

  ipcMain.handle('tags:update', (_e, id: number, name: string, color?: string | null): { error?: string } =>
    updateTag(id, name, color)
  )

  ipcMain.handle('tags:remove', (_e, id: number): void => removeTag(id))

  ipcMain.handle('authors:list', (): Author[] => listAuthors())
  ipcMain.handle('authors:add', (_e, name: string, color?: string | null): Author | { error: string } =>
    addAuthor(name, color)
  )
  ipcMain.handle('authors:update', (_e, id: number, name: string, color?: string | null): { error?: string } =>
    updateAuthor(id, name, color)
  )
  ipcMain.handle('authors:remove', (_e, id: number): void => removeAuthor(id))

  /** 清空全部视频数据（仅移除记录；封面/关键帧等程序生成文件交由引用计数 GC 清理，不删除用户本地文件） */
  ipcMain.handle('videos:clear-all', (): { ok: boolean; count: number } => {
    const db = getDb()
    const count = (db.prepare('SELECT COUNT(*) AS c FROM videos').get() as { c: number }).c
    db.prepare('DELETE FROM videos').run()
    try {
      sweepOrphanAssets()
    } catch {
      /* GC 失败不影响 */
    }
    return { ok: true, count }
  })

  /**
   * 删除视频记录。与物理文件解耦：
   *  - deleteFile=true 且路径指向真实文件 → 删除用户视频文件（用户显式请求）；
   *  - 封面/关键帧属程序生成物，不在此立即删除，改由引用计数 GC（sweepOrphanAssets）在删除后清理孤儿文件。
   */
  ipcMain.handle(
    'videos:remove',
    (_e, id: number, deleteFile: boolean): { ok: boolean; error?: string } => {
      const row = getDb()
        .prepare('SELECT file_path FROM videos WHERE id = ?')
        .get(id) as { file_path: string } | undefined
      if (!row) return { ok: false, error: '视频不存在' }
      try {
        if (deleteFile && row.file_path && existsSync(row.file_path)) {
          rmSync(row.file_path, { force: true })
        }
        getDb().prepare('DELETE FROM videos WHERE id = ?').run(id)
        try {
          sweepOrphanAssets()
        } catch {
          /* GC 失败不影响 */
        }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // ============ M5：批量重命名 ============

  ipcMain.handle(
    'rename:preview',
    (
      _e,
      videos: Array<{ id?: number; filePath: string; title: string }>,
      rules: RenameRules
    ): RenamePreviewItem[] => buildRenamePreview(videos, rules)
  )

  ipcMain.handle('rename:apply', (_e, plan: RenamePreviewItem[]): RenameResult => applyRename(plan))

  ipcMain.handle('rename:undo', (): RenameResult => undoRename())

  ipcMain.handle('rename:undo-available', (): boolean => isUndoAvailable())

  // 批量修改扩展名（类似 DOS ren *.txt *.doc）
  ipcMain.handle(
    'rename:change-extension',
    (_e, folder: string, fromExt: string, toExt: string): ReturnType<typeof changeExtension> =>
      changeExtension(folder, fromExt, toExt)
  )
  ipcMain.handle('rename:undo-extension', (): ReturnType<typeof undoExtensionChange> =>
    undoExtensionChange()
  )

  // ============ M6：PotPlayer 播放 ============

  ipcMain.handle('player:detect', (): Promise<PlayerDetectResult> => detectPotPlayer())

  ipcMain.handle('player:play', (_e, videoPath: string): Promise<PlayerPlayResult> =>
    playWithPotPlayer(videoPath)
  )

  ipcMain.handle('player:save-path', (_e, path: string): void => savePotPlayerPath(path))

  /** 手动选择 PotPlayer 可执行文件（设置页「选择…」按钮） */
  ipcMain.handle('dialog:select-player', async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const res = win
      ? await dialog.showOpenDialog(win, {
          title: '选择 PotPlayer 可执行文件',
          properties: ['openFile'],
          filters: [
            { name: '可执行文件', extensions: ['exe'] },
            { name: '所有文件', extensions: ['*'] }
          ]
        })
      : await dialog.showOpenDialog({
          title: '选择 PotPlayer 可执行文件',
          properties: ['openFile'],
          filters: [
            { name: '可执行文件', extensions: ['exe'] },
            { name: '所有文件', extensions: ['*'] }
          ]
        })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })

  // ============ M7：格式转换（导入制） ============

  ipcMain.handle('dialog:select-files', async (): Promise<string[] | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const res = win
      ? await dialog.showOpenDialog(win, {
          properties: ['openFile', 'multiSelections'],
          filters: [
            { name: '视频文件', extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'ts', 'm2ts', 'm4v', 'mpg', 'mpeg', '3gp'] }
          ]
        })
      : await dialog.showOpenDialog({
          properties: ['openFile', 'multiSelections'],
          filters: [
            { name: '视频文件', extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'ts', 'm2ts', 'm4v', 'mpg', 'mpeg', '3gp'] }
          ]
        })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths
  })

  ipcMain.handle('convert:inspect', (_e, paths: string[]): Promise<ConvertFileInfo[]> =>
    inspectFiles(paths)
  )

  ipcMain.handle('convert:collect-folder', (_e, folder: string): Promise<string[]> =>
    collectVideoFilesInFolder(folder)
  )

  ipcMain.handle(
    'convert:start',
    (_e, items: ConvertItem[], options: Omit<ConvertOptions, 'filePath' | 'videoId'>): number => {
      let enqueued = 0
      for (const item of items) {
        taskQueue.enqueue('convert', { filePath: item.path, videoId: item.videoId, ...options })
        enqueued++
      }
      return enqueued
    }
  )

  ipcMain.handle('settings:convert-output-dir', (_e, dir: string | null): string => {
    if (dir !== null && dir !== undefined) setSetting('convert_output_dir', dir)
    return getSetting('convert_output_dir') ?? ''
  })

  /** 元数据编辑页下拉列表排序配置（分类/作者/标签：名称或数量 × 正倒） */
  ipcMain.handle('settings:meta-edit-sort', (_e, cfg?: MetaSortConfig | null): MetaSortConfig => {
    const DEFAULT: MetaSortConfig = {
      category: { by: 'name', dir: 'asc' },
      author: { by: 'count', dir: 'desc' },
      tag: { by: 'name', dir: 'asc' }
    }
    if (cfg) setSetting('meta_edit_sort', JSON.stringify(cfg))
    const raw = getSetting('meta_edit_sort')
    if (raw) {
      try {
        return { ...DEFAULT, ...(JSON.parse(raw) as Partial<MetaSortConfig>) }
      } catch {
        /* fallthrough */
      }
    }
    return DEFAULT
  })

  /** 视频库每页显示数量（默认 42） */
  ipcMain.handle('settings:page-size', (_e, value?: number): number => {
    if (value !== undefined && value >= PAGE_SIZE_MIN && value <= PAGE_SIZE_MAX) {
      setSetting('page_size', String(value))
    }
    const cur = Number(getSetting('page_size') ?? '42')
    return Math.min(Math.max(cur, PAGE_SIZE_MIN), PAGE_SIZE_MAX)
  })

  /** 视频库封面显示模式：landscape=横屏比例（默认） / normal=正常比例 */
  ipcMain.handle('settings:cover-mode', (_e, value?: string): string => {
    if (value === 'landscape' || value === 'normal') setSetting('cover_mode', value)
    return getSetting('cover_mode') ?? 'landscape'
  })

  /** 元数据备份设置：备份目录 / 自动备份开关 */
  ipcMain.handle(
    'settings:meta-backup',
    (_e, opts?: { dir?: string | null; auto?: boolean | null }): {
      dir: string
      auto: boolean
      count: number
      lastBackupAt: string | null
    } => {
      if (opts?.dir !== undefined && opts.dir !== null) setSetting('meta_backup_dir', opts.dir)
      if (opts?.auto !== undefined && opts.auto !== null) setSetting('meta_backup_auto', opts.auto ? '1' : '0')
      return {
        dir: getSetting('meta_backup_dir') ?? '',
        auto: getSetting('meta_backup_auto') === '1',
        count: (getDb().prepare('SELECT COUNT(*) AS c FROM videos WHERE sha256 IS NOT NULL AND sha256 != \'\'').get() as { c: number }).c,
        lastBackupAt: getSetting('meta_backup_last_at')
      }
    }
  )

  /** 立即备份元数据到备份目录（ZIP 含 JSON + 封面，文件名带时间到秒，保留最近 30 份） */
  ipcMain.handle('settings:meta-backup-now', async (): Promise<{ ok: boolean; path?: string; error?: string }> => {
    try {
      const dir = getSetting('meta_backup_dir')
      if (!dir) return { ok: false, error: '请先设置备份目录' }
      const { mkdirSync, readdirSync, rmSync, writeFileSync } = await import('node:fs')
      const { join } = await import('node:path')
      mkdirSync(dir, { recursive: true })
      const { zip, count } = buildExportZip()
      const stamp = beijingStamp()
      const file = join(dir, `videomanager-backup-${stamp}.zip`)
      writeFileSync(file, Buffer.from(zip))
      // 清理：保留最近 30 份
      const files = readdirSync(dir).filter((f) => f.startsWith('videomanager-backup-')).sort()
      while (files.length > 30) {
        const old = files.shift()!
        try {
          rmSync(join(dir, old), { force: true })
        } catch {
          /* ignore */
        }
      }
      setSetting('meta_backup_last_at', new Date().toLocaleString('zh-CN'))
      return { ok: true, path: file, ...(count !== undefined ? { count } : {}) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ============ 备份恢复（安全重构：可预览 / 可配置 / 可回滚） ============

  /** 待执行恢复的计划缓存（选文件解析后保留，避免二次选文件；不含任何图片数据） */
  let pendingRestore: {
    zipPath: string
    manifest: ZipManifest
    summary: RestoreSummary
    kindBySha: Map<string, 'backupOnly' | 'conflict' | 'identical'>
    items: RestoreDiffItem[]
  } | null = null

  /** 选择备份文件 → 基础完整性校验 + 与本地差异分析（只读不写盘） */
  ipcMain.handle('settings:meta-restore-plan', async (): Promise<RestorePlanResult> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const res = win
      ? await dialog.showOpenDialog(win, {
          title: '选择备份文件',
          properties: ['openFile'],
          filters: [{ name: 'VideoManager 备份', extensions: ['zip'] }]
        })
      : await dialog.showOpenDialog({
          title: '选择备份文件',
          properties: ['openFile'],
          filters: [{ name: 'VideoManager 备份', extensions: ['zip'] }]
        })
    if (res.canceled || res.filePaths.length === 0) return { ok: false, error: '已取消' }
    const zipPath = res.filePaths[0]
    const manifest = loadZipManifest(zipPath)
    if (!manifest.ok) return { ok: false, error: manifest.error }
    try {
      const { summary, items, kindBySha } = buildDiff(manifest)
      pendingRestore = { zipPath, manifest, summary, kindBySha, items }
      return { ok: true, backupName: basename(zipPath), summary }
    } catch (err) {
      pendingRestore = null
      return { ok: false, error: `差异分析失败：${err instanceof Error ? err.message : String(err)}` }
    }
  })

  /** 差异明细（kind 过滤；省略返回全部） */
  ipcMain.handle('settings:meta-restore-diff', (_e, kind?: RestoreDiffKind | null): RestoreDiffItem[] => {
    if (!pendingRestore) return []
    return kind ? pendingRestore.items.filter((i) => i.kind === kind) : pendingRestore.items
  })

  /** 执行恢复：自动快照 → DB 事务 → 图片写回 → 引用计数 GC → 日志 */
  ipcMain.handle('settings:meta-restore-execute', async (_e, mode: RestoreMode): Promise<RestoreExecuteResult> => {
    if (!pendingRestore) return { ok: false, error: '请先选择并分析备份文件' }
    if (!['full', 'backup-first', 'local-first', 'missing-only'].includes(mode)) {
      return { ok: false, error: '无效的恢复模式' }
    }
    const plan = pendingRestore
    try {
      const result = await executeRestore({
        zipPath: plan.zipPath,
        mode,
        manifest: plan.manifest,
        kindBySha: plan.kindBySha,
        summary: plan.summary
      })
      if (result.ok) {
        // 仅成功才清除计划；失败（DB 事务已回滚）保留以便调整模式重试
        pendingRestore = null
        maybeAutoBackup()
      }
      return result
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /** 最近恢复/回滚日志 */
  ipcMain.handle('settings:meta-restore-logs', (_e, limit?: number): RestoreLog[] => listRestoreLogs(limit))

  /** 回滚到某次恢复前的自动快照（logId 来自恢复日志）；回滚后日志随快照回到恢复前状态，见 restore.rollbackByLogId */
  ipcMain.handle(
    'settings:meta-restore-rollback',
    async (_e, logId: number): Promise<{ ok: boolean; error?: string; gcRemoved?: number }> => rollbackByLogId(logId)
  )

  // ============ M8：局域网服务 ============

  ipcMain.handle('server:status', (): ServerStatus => getServerStatus())
  ipcMain.handle('server:restart', (_e, port?: number): { port: number; error: string | null } => {
    if (port) setSetting('server_port', String(port))
    setSetting('server_enabled', '1')
    return startHttpServer()
  })

  ipcMain.handle('server:stop', (): void => {
    setSetting('server_enabled', '0')
    stopHttpServer()
  })

  // ============ 统计区域 ============

  ipcMain.handle('stats:summary', (): StatsSummary => getStatsSummary())
}
