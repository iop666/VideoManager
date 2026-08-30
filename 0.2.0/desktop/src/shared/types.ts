// 共享类型（main / preload / renderer 三端复用，纯类型，无运行时依赖）
// 与 docs/data-model.md、docs/api-contract.md 保持一致

export interface DbStats {
  videos: number
  categories: number
  tags: number
  tasks: number
  importFolders: number
}

export interface FfmpegInfo {
  ffmpeg: string | null
  ffprobe: string | null
  error: string | null
}

export interface AppInfo {
  /** 应用版本（app.getVersion()，打包后来自 package.json version） */
  version: string
  versions: { electron: string; node: string; chrome: string }
  dbPath: string
  dbStats: DbStats
  ffmpeg: FfmpegInfo
}

export interface ImportFolder {
  id: number
  path: string
  recursive: number
  enabled: number
  last_scanned_at: string | null
}

export type TaskType = 'import' | 'thumbnail' | 'convert' | 'rename'
export type TaskStatus = 'pending' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'

export interface Task {
  id: number
  type: TaskType
  status: TaskStatus
  /** 任务负载（JSON 解析后的对象） */
  payload: unknown
  progress: number
  message: string | null
  created_at: string
  updated_at: string | null
  started_at: string | null
  finished_at: string | null
}

// ================= M3：视频列表与详情 =================

export type SortField = 'date_added' | 'title' | 'duration' | 'rating' | 'file_size' | 'play_count'
export type SortDir = 'asc' | 'desc'
export type Orientation = 'landscape' | 'portrait' | 'square'

export interface VideoListQuery {
  page: number
  pageSize: number
  search?: string
  categoryId?: number | null
  tagId?: number | null
  authorId?: number | null
  favorite?: boolean
  orientation?: Orientation | null
  /** true = 包含已缺失文件 */
  includeMissing?: boolean
  /** true = 隐藏本地文件（只显示没有真实本地文件的记录：缺失 + 恢复占位） */
  hideLocal?: boolean
  sortBy?: SortField
  sortDir?: SortDir
}

export interface VideoListItem {
  id: number
  title: string
  fileName: string
  filePath: string
  fileSize: number
  duration: number | null
  width: number | null
  height: number | null
  codec: string | null
  format: string | null
  categoryId: number | null
  category: string | null
  tags: string[]
  rating: number | null
  isFavorite: number
  thumbnailPath: string | null
  dateAdded: string
  status: string
  remark: string | null
  author: string | null
  authorId: number | null
  /** 横屏/竖屏（由宽高派生） */
  orientation: Orientation
  /** SHA-256 唯一身份（导入时计算） */
  sha256: string | null
  hashComputed: number
  playCount: number
  lastPlayedAt: string | null
  /** 元数据最近保存时间（安卓端增量同步用） */
  metaUpdatedAt: string | null
}

export interface VideoListResult {
  items: VideoListItem[]
  total: number
  page: number
  pageSize: number
}

export interface VideoUpdateFields {
  title?: string
  rating?: number | null
  remark?: string | null
  author?: string | null
  authorId?: number | null
  isFavorite?: boolean
  categoryId?: number | null
}

export interface Author {
  id: number
  name: string
  videoCount: number
  color: string | null
}

/** 重复视频组（同 SHA-256） */
export interface DuplicateGroup {
  hash: string
  count: number
  items: Array<{ id: number; title: string; filePath: string; fileSize: number }>
}

export interface Category {
  id: number
  name: string
  parentId: number | null
  sortOrder: number
  videoCount: number
  color: string | null
}

export interface Tag {
  id: number
  name: string
  videoCount: number
  color: string | null
}

// ================= M5：批量重命名 =================

/** 重命名规则：仅支持添加前缀/后缀（用户要求简化，避免复杂规则出错） */
export interface RenameRules {
  prefix: string
  suffix: string
}

export interface RenamePreviewItem {
  videoId: number
  oldName: string
  newName: string
  oldPath: string
  newPath: string
  /** 目标路径已存在其他文件（冲突，不会执行） */
  conflict: boolean
  /** 新名与旧名相同（忽略） */
  unchanged: boolean
}

export interface RenameResult {
  renamed: number
  failed: { path: string; error: string }[]
  undoAvailable: boolean
  undoCount: number
}

// ================= M6：播放器 =================

export interface PlayerDetectResult {
  path: string | null
  error: string | null
}

export interface PlayerPlayResult {
  ok: boolean
  player: string | null
  error: string | null
}

// ================= M7：格式转换 =================

export type ConvertFormat = 'mp4' | 'mkv' | 'webm'

export interface ConvertOptions {
  /** 源文件路径（导入制） */
  filePath: string
  /** 关联的视频库记录（可选） */
  videoId?: number
  format: ConvertFormat
  /** CRF 画质（18 高质量 ~ 28 低质量） */
  crf: number
  /** 目标宽度（等比缩放），null = 原始 */
  scale?: number | null
  /** 输出目录（'source' = 文件原目录；字符串 = 指定目录；null = 默认） */
  outputDir?: string | 'source' | null
  /** 完成后删除源文件 */
  deleteSource: boolean
}

/** 转换清单条目（探测后展示用） */
export interface ConvertFileInfo {
  path: string
  name: string
  size: number
  duration: number | null
  format: string | null
}

/** 转换发起条目（文件 + 可选关联视频） */
export interface ConvertItem {
  path: string
  videoId?: number
}

export interface ConvertSettings {
  outputDir: string
}

// ================= M8：局域网服务 =================

export interface ServerStatus {
  running: boolean
  port: number
  address: string | null
  /** 当前待配对码（未过期） */
  pairCode: string | null
  pairedDevices: number
  /** 已配对设备明细（名称 + 最后在线时间） */
  devices: Array<{ id: number; name: string; lastSeenAt: string | null }>
}

// ================= 统计区域 =================

export interface CategoryStat {
  id: number
  name: string
  videoCount: number
}

export interface TagStat {
  id: number
  name: string
  videoCount: number
}

export interface StatsSummary {
  totalVideos: number
  /** 总时长（秒） */
  totalDuration: number
  totalSize: number
  categories: CategoryStat[]
  tags: TagStat[]
  authors: Array<{ id: number; name: string; videoCount: number; color: string | null }>
  /** 横屏/竖屏/方形 计数 */
  orientation: { landscape: number; portrait: number; square: number }
  /** 重复视频组（同 SHA-256） */
  duplicates: DuplicateGroup[]
  /** 已计算 SHA-256 身份的视频数 */
  hashedVideos: number
}
