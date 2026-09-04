import { app, BrowserWindow, dialog, nativeImage, shell } from 'electron'
import { join, dirname } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initDatabase, closeDatabase, getSetting } from './db'
import { registerIpcHandlers } from './ipc'
import { listTasks, TaskQueue } from './services/taskQueue'
import { scanFolder } from './services/scanner'
import { listVideos } from './services/videos'
import { applyRename, buildRenamePreview, undoRename } from './services/rename'
import { startHttpServer, stopHttpServer } from './services/httpServer'
import { convertFile } from './services/converter'
import type { RenameRules } from '../shared/types'

// 数据目录：优先放在软件所在目录（绿色版/便携版/直接运行场景，DB/缩略图等随软件目录走）
// 若软件目录不可写（如 Program Files 安装版），回退到 %APPDATA%\VideoManager
function resolveUserDataDir(): string {
  // 测试钩子优先
  if (process.env.VM_USER_DATA) return process.env.VM_USER_DATA
  // 软件所在目录：打包后 = 绿色版 exe 目录 / 安装版安装目录
  // 直接运行（electron out/main/index.js）：getAppPath 指向 main 脚本所在（out/main），
  // 需向上找到含 package.json 的应用根目录
  let appDir = app.isPackaged ? dirname(process.execPath) : app.getAppPath()
  if (!app.isPackaged) {
    // 向上查找含 package.json 的目录作为应用根
    const { existsSync } = require('node:fs') as typeof import('node:fs')
    let cur = appDir
    while (dirname(cur) !== cur) {
      if (existsSync(join(cur, 'package.json'))) {
        appDir = cur
        break
      }
      cur = dirname(cur)
    }
  }
  const dataDir = join(appDir, 'data')
  try {
    // 测试目录可写性：安装版（Program Files）不可写则回退 APPDATA
    const probe = join(appDir, '.vm_writable_probe')
    require('node:fs').writeFileSync(probe, '1')
    require('node:fs').rmSync(probe, { force: true })
    return dataDir
  } catch {
    // 不可写（如 Program Files）：回退 APPDATA
    return join(app.getPath('appData'), 'VideoManager')
  }
}

const userDataDir = resolveUserDataDir()
app.setPath('userData', userDataDir)

// ============ 单实例：只允许前台运行一个，重复打开弹提醒并聚焦 ============
let mainWindow: BrowserWindow | null = null
const gotSingleLock = app.requestSingleInstanceLock()
if (!gotSingleLock) {
  // 已有实例在运行，退出本次启动
  app.quit()
} else {
  app.on('second-instance', () => {
    // 第二个实例启动时，聚焦已有窗口并弹提醒
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'VideoManager',
        message: 'VideoManager 已在运行',
        detail: '程序只允许前台运行一个实例，已跳转到现有窗口。',
        buttons: ['确定']
      })
    }
  })
}

const smokeIndex = process.argv.indexOf('--smoke-scan')
const smokeTaskIndex = process.argv.indexOf('--smoke-task')
const smokeRenameIndex = process.argv.indexOf('--smoke-rename')
const smokeRenameUndoIndex = process.argv.indexOf('--smoke-rename-undo')
const smokeConvertIndex = process.argv.indexOf('--smoke-convert')
const smokeRenameFileIndex = process.argv.indexOf('--smoke-rename-file')

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    title: 'VideoManager',
    backgroundColor: '#0e0e0e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Windows 任务栏/窗口图标：显式用 ico 生成 nativeImage 并设置
  // 打包后 extraResources 把 icon.ico 放到 process.resourcesPath（asar 外，绿色目录）
  const icoPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(app.getAppPath(), 'resources', 'icon.ico')
  const appIcon = nativeImage.createFromPath(icoPath)
  if (!appIcon.isEmpty()) {
    mainWindow.setIcon(appIcon)
    app.setName('VideoManager')
  }

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 渲染进程诊断日志（try/catch 防止 stdout 管道断时 EPIPE 崩溃主进程）
  mainWindow.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) {
      try {
        console.log('[renderer]', message)
      } catch {
        /* stdout 管道不可用时忽略 */
      }
    }
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[videomanager] 渲染进程异常退出:', details.reason)
  })
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('[videomanager] 页面加载失败:', code, desc)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(async () => {
  // 单实例锁失败（已有实例运行）时不初始化，直接退出
  if (!gotSingleLock) return

  electronApp.setAppUserModelId('com.videomanager.desktop')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  try {
    initDatabase()
    console.log('[videomanager] SQLite 数据库初始化完成')
  } catch (err) {
    console.error('[videomanager] 数据库初始化失败:', err)
  }

  // 无头冒烟模式：electron out/main/index.js --smoke-scan <folder>
  if (smokeIndex !== -1) {
    const folder = process.argv[smokeIndex + 1]
    if (!folder) {
      console.error('[smoke] 缺少参数：--smoke-scan <folder>')
      app.exit(1)
      return
    }
    try {
      const result = await scanFolder(folder, {
        recursive: true,
        onProgress: (p) => console.log(`[smoke] ${p.phase} ${p.current}/${p.total}`)
      })
      console.log('[smoke] RESULT ' + JSON.stringify(result))
    } catch (err) {
      console.error('[smoke] ERROR', err)
      app.exit(1)
      return
    }
    closeDatabase()
    app.exit(0)
    return
  }

  // 无头冒烟模式：--smoke-rename-file <file> [prefix] [suffix]
  if (smokeRenameFileIndex !== -1) {
    const file = process.argv[smokeRenameFileIndex + 1]
    const prefix = process.argv[smokeRenameFileIndex + 2] ?? ''
    const suffix = process.argv[smokeRenameFileIndex + 3] ?? ''
    if (!file) {
      console.error('[smoke-rename-file] 缺少参数：--smoke-rename-file <file> [prefix] [suffix]')
      app.exit(1)
      return
    }
    const rules: RenameRules = { prefix, suffix }
    const plan = buildRenamePreview([{ filePath: file, title: file.split(/[\\/]/).pop() ?? '' }], rules)
    console.log('[smoke-rename-file] plan=' + JSON.stringify(plan))
    const result = applyRename(plan)
    console.log('[smoke-rename-file] ' + JSON.stringify(result))
    closeDatabase()
    app.exit(0)
    return
  }

  // 无头冒烟模式：--smoke-convert <file> [outDir]
  if (smokeConvertIndex !== -1) {
    const file = process.argv[smokeConvertIndex + 1]
    const outDir = process.argv[smokeConvertIndex + 2]
    if (!file) {
      console.error('[smoke-convert] 缺少参数：--smoke-convert <file> [outDir]')
      app.exit(1)
      return
    }
    try {
      const result = await convertFile({
        filePath: file,
        format: 'mp4',
        crf: 18,
        scale: null,
        outputDir: outDir || null,
        deleteSource: false
      })
      console.log('[smoke-convert] RESULT ' + JSON.stringify(result))
    } catch (err) {
      console.error('[smoke-convert] ERROR', err)
      app.exit(1)
      return
    }
    closeDatabase()
    app.exit(0)
    return
  }

  // 无头冒烟模式：--smoke-rename <folder> [prefix] [suffix]
  if (smokeRenameIndex !== -1 || smokeRenameUndoIndex !== -1) {
    if (smokeRenameUndoIndex !== -1) {
      const res = undoRename()
      console.log('[smoke-rename-undo] ' + JSON.stringify(res))
      closeDatabase()
      app.exit(0)
      return
    }
    const folder = process.argv[smokeRenameIndex + 1]
    const prefix = process.argv[smokeRenameIndex + 2] ?? ''
    const suffix = process.argv[smokeRenameIndex + 3] ?? ''
    if (!folder) {
      console.error('[smoke-rename] 缺少参数：--smoke-rename <folder> [prefix] [suffix]')
      app.exit(1)
      return
    }
    const result = listVideos({ page: 1, pageSize: 500, search: '' })
    const videos = result.items
      .filter((v) => v.filePath.toLowerCase().startsWith(folder.toLowerCase()))
      .map((v) => ({ id: v.id, filePath: v.filePath, title: v.title }))
    const rules: RenameRules = { prefix, suffix }
    const plan = buildRenamePreview(videos, rules)
    const renamed = applyRename(plan)
    console.log('[smoke-rename] plan=' + JSON.stringify(plan))
    console.log('[smoke-rename] ' + JSON.stringify(renamed))
    if (process.argv.includes('--undo-after')) {
      const undone = undoRename()
      console.log('[smoke-rename-undo] ' + JSON.stringify(undone))
    }
    closeDatabase()
    app.exit(0)
    return
  }

  // 无头冒烟模式：--smoke-task <folder>（走完整任务队列链路）
  if (smokeTaskIndex !== -1) {
    const folder = process.argv[smokeTaskIndex + 1]
    if (!folder) {
      console.error('[smoke-task] 缺少参数：--smoke-task <folder>')
      app.exit(1)
      return
    }
    const queue = new TaskQueue()
    queue.on('changed', () => {
      const rows = listTasks(1)
      if (rows.length > 0 && (rows[0].status === 'done' || rows[0].status === 'failed')) {
        console.log('[smoke-task] ' + JSON.stringify(rows[0]))
        closeDatabase()
        app.exit(rows[0].status === 'done' ? 0 : 1)
      }
    })
    queue.enqueue('import', { folderPath: folder, recursive: true })
    return
  }

  const taskQueue = new TaskQueue()
  taskQueue.on('changed', () => {
    const tasks = listTasks(100)
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('tasks:changed', tasks)
    }
  })

  // 局域网 HTTP 服务（Android 端连接）：默认关闭，需在设置页手动开启（server_enabled=1）
  if (getSetting('server_enabled') === '1') {
    const serverResult = startHttpServer()
    if (serverResult.error) {
      console.error('[videomanager] 局域网服务启动失败:', serverResult.error)
    }
  }

  registerIpcHandlers(taskQueue)
  mainWindow = createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    mainWindow = null
    stopHttpServer()
    closeDatabase()
    app.quit()
  }
})
