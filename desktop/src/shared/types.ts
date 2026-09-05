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
  /** true = 仅显示未分类：分类或作者至少一项未填写（两者都有数据则不显示） */
  uncategorized?: boolean
  sortBy?: SortField
  sortDir?: SortDir
}

export interface MetaSortRule {
  /** name=按名称 / count=按数量(使用该分类/标签/作者的视频数) */
  by: 'name' | 'count'
  dir: 'asc' | 'desc'
}

/** 元数据编辑页分类/作者/标签选择列表的排序配置 */
export interface MetaSortConfig {
  category: MetaSortRule
  author: MetaSortRule
  tag: MetaSortRule
}

/** 每页显示自定义范围（设置页只保留自定义输入） */
export const PAGE_SIZE_MIN = 2
export const PAGE_SIZE_MAX = 525

/** 单张关键帧截图记录（DB videos.keyframes JSON 数组元素，扫描时自动生成） */
export interface KeyframeShot {
  /** 文件名（Keyframe_<sha256>_NN.jpg），与关键帧目录拼接得到完整路径 */
  name: string
  /** 截图所在时间点（秒） */
  timeSec: number
  /** 截图对应视频帧号（≈ timeSec × fps；fps 未知时为 0） */
  frameNo: number
  /** 关键帧规格版本：v2 = 长边 960px + q4 压缩（省空间）；旧库无此字段 = 原分辨率 q2 */
  v?: number
}

export interface VideoListItem {
  id: number
  title: string
  fileName: string
  /** 该 SHA-256 身份历史记录过的全部文件名（导入时自动记录，用户不可修改） */
  moreFileNames: string[]
  filePath: string
  fileSize: number
  duration: number | null
  /** 帧率（ffprobe avg_frame_rate 解析） */
  fps: number | null
  /** 视频总帧数（时长 × 帧率取整） */
  frameCount: number | null
  /** 关键帧截图记录（扫描时自动生成，最多 10 张） */
  keyframes: KeyframeShot[]
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

/** 批量修改字段（标题不支持批量）；分类/作者/备注 null = 清除 */
export type BatchVideoPatch = Pick<
  VideoUpdateFields,
  'rating' | 'remark' | 'author' | 'authorId' | 'isFavorite' | 'categoryId'
>

export interface BatchVideoResult {
  ok: boolean
  error?: string
  updated: number
}

export interface BatchRemoveResult {
  ok: boolean
  error?: string
  /** 移除的记录数 */
  removed: number
  /** 实际删除的用户视频文件数 */
  deletedFiles: number
}

/** 单任务操作结果（取消/暂停/继续/重试/删除） */
export interface TaskActionResult {
  ok: boolean
  error?: string
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

// ================= 备份恢复安全重构（可预览 / 可配置 / 可回滚） =================

/** 恢复模式 */
export type RestoreMode = 'full' | 'backup-first' | 'local-first' | 'missing-only'

/** 差异条目类别 */
export type RestoreDiffKind = 'backupOnly' | 'localOnly' | 'conflict' | 'identical'

/** 恢复前差异摘要（备份 vs 本地库，以 SHA-256 身份为键） */
export interface RestoreSummary {
  /** 备份内去重后的有效条目数 */
  backupTotal: number
  /** 备份内重复 SHA-256 的条数（自动合并，仅保留首个） */
  duplicatesInBackup: number
  /** 无效条目数（SHA-256 非法等，被忽略） */
  invalidEntries: number
  /** 本地库中已建立 SHA-256 身份的记录数 */
  localTotal: number
  /** 仅备份有（本地缺失） */
  backupOnly: number
  /** 仅本地有（备份缺失） */
  localOnly: number
  /** 两边都有但元数据不一致 */
  conflict: number
  /** 两边都有且元数据完全一致 */
  identical: number
  /** 备份条目中缺少对应 images/<sha256>.jpg 的封面数（图片可重建，警告） */
  missingCovers: number
  /** 是否为旧版备份格式（无 meta 头部的裸数组） */
  legacy: boolean
}

/** 差异明细条目 */
export interface RestoreDiffItem {
  kind: RestoreDiffKind
  sha256: string
  backupTitle: string | null
  localTitle: string | null
  backupCategory: string | null
  localCategory: string | null
  backupTags: string[]
  localTags: string[]
  backupAuthor: string | null
  localAuthor: string | null
  /** 冲突字段名（title/category/tags/author/rating/remark/favorite） */
  conflictFields: string[]
}

/** 恢复执行结果统计 */
export interface RestoreStats {
  inserted: number
  updated: number
  /** 因模式（完全恢复）被移除的本地独有记录数 */
  removed: number
  skipped: number
  coversWritten: number
  coversFailed: number
  keyframesWritten: number
  keyframesFailed: number
  /** 垃圾回收清理的孤儿封面/关键帧文件数 */
  gcRemoved: number
  elapsedMs: number
}

export interface RestoreExecuteResult {
  ok: boolean
  error?: string
  /** restore_logs 行 id */
  logId?: number
  /** 本次恢复自动创建的快照目录（可回滚到此处） */
  snapshotDir?: string | null
  stats?: RestoreStats
}

/** 恢复/回滚日志（restore_logs 表行） */
export interface RestoreLog {
  id: number
  createdAt: string
  kind: 'restore' | 'rollback'
  mode: RestoreMode | null
  backupFile: string | null
  snapshotDir: string | null
  /** 差异摘要 JSON */
  summary: RestoreSummary | null
  /** 执行统计 JSON */
  stats: RestoreStats | null
  result: 'ok' | 'failed' | 'rolled_back'
  error: string | null
  elapsedMs: number | null
}

export interface RestorePlanResult {
  ok: boolean
  error?: string
  /** 备份文件名 */
  backupName?: string
  summary?: RestoreSummary
}
