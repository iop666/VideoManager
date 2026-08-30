import { existsSync, renameSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { getDb } from '../db'
import type { RenamePreviewItem, RenameResult, RenameRules } from '../../shared/types'

/** 重命名目标：视频库记录（有 id）或任意文件（无 id，导入制） */
export interface RenameTarget {
  id?: number
  filePath: string
  title: string
}

interface UndoEntry {
  videoId?: number
  oldPath: string
  newPath: string
  oldTitle: string
  newTitle: string
  oldFileName: string
  newFileName: string
}

const undoStack: UndoEntry[] = []

/** 对单个文件名（不含扩展名）应用规则（仅前缀/后缀） */
export function transformName(baseName: string, rules: RenameRules): string {
  let name = baseName
  if (rules.prefix) name = rules.prefix + name
  if (rules.suffix) name = name + rules.suffix
  return name
}

/** 生成重命名预览（对给定目标；冲突/未变化标记） */
export function buildRenamePreview(
  videos: RenameTarget[],
  rules: RenameRules
): RenamePreviewItem[] {
  const taken = new Set<string>()
  for (const v of videos) taken.add(v.filePath.toLowerCase())

  return videos.map((v) => {
    const dir = dirname(v.filePath)
    const oldExt = extname(v.filePath)
    const oldBase = basename(v.filePath, oldExt)
    const newBase = transformName(oldBase, rules)
    const newPath = join(dir, newBase + oldExt)

    const conflict = !taken.has(v.filePath.toLowerCase()) && existsSync(newPath)
    const unchanged = newBase === oldBase || newPath.toLowerCase() === v.filePath.toLowerCase()

    return {
      videoId: v.id ?? 0,
      oldName: oldBase + oldExt,
      newName: unchanged ? oldBase + oldExt : newBase + oldExt,
      oldPath: v.filePath,
      newPath,
      conflict,
      unchanged
    }
  })
}

/** 执行重命名（跳过 conflict / unchanged），记录撤销栈；videoId 存在时同步更新数据库 */
export function applyRename(plan: RenamePreviewItem[]): RenameResult {
  const db = getDb()
  let renamed = 0
  const failed: { path: string; error: string }[] = []
  const batch: UndoEntry[] = []

  for (const item of plan) {
    if (item.conflict || item.unchanged) continue
    try {
      let oldTitle: { title: string; file_name: string } | undefined
      let videoId: number | undefined
      if (item.videoId) {
        oldTitle = db.prepare('SELECT title, file_name FROM videos WHERE id = ?').get(item.videoId) as
          | { title: string; file_name: string }
          | undefined
        videoId = item.videoId
      }
      renameSync(item.oldPath, item.newPath)
      const newFileName = basename(item.newPath)
      const newTitle = newFileName.replace(extname(newFileName), '')
      if (videoId && oldTitle) {
        db.prepare(
          'UPDATE videos SET file_path = ?, file_name = ?, title = CASE WHEN title = ? THEN ? ELSE title END WHERE id = ?'
        ).run(item.newPath, newFileName, oldTitle.title, newTitle, videoId)
      }
      batch.push({
        videoId,
        oldPath: item.oldPath,
        newPath: item.newPath,
        oldTitle: oldTitle?.title ?? '',
        newTitle,
        oldFileName: oldTitle?.file_name ?? '',
        newFileName
      })
      renamed++
    } catch (err) {
      failed.push({ path: item.oldPath, error: err instanceof Error ? err.message : String(err) })
    }
  }

  if (batch.length > 0) undoStack.push(...batch)
  return { renamed, failed, undoAvailable: undoStack.length > 0, undoCount: undoStack.length }
}

/** 撤销上一次重命名（整批） */
export function undoRename(): RenameResult {
  const db = getDb()
  if (undoStack.length === 0) return { renamed: 0, failed: [], undoAvailable: false, undoCount: 0 }
  const batch = undoStack.splice(0, undoStack.length)
  let renamed = 0
  const failed: { path: string; error: string }[] = []
  for (const e of batch) {
    try {
      renameSync(e.newPath, e.oldPath)
      if (e.videoId) {
        db.prepare(
          'UPDATE videos SET file_path = ?, file_name = ?, title = CASE WHEN title = ? THEN ? ELSE title END WHERE id = ?'
        ).run(e.oldPath, e.oldFileName, e.newTitle, e.oldTitle, e.videoId)
      }
      renamed++
    } catch (err) {
      failed.push({ path: e.newPath, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { renamed, failed, undoAvailable: undoStack.length > 0, undoCount: undoStack.length }
}

export function isUndoAvailable(): boolean {
  return undoStack.length > 0
}
