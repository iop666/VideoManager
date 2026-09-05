import { EventEmitter } from 'node:events'
import { getDb } from '../db'
import type { Task, TaskType } from '../../shared/types'
import { scanFolder } from './scanner'
import { convertFile, type ConvertOptions } from './converter'
import { generateKeyframesForFolder } from './keyframes'
import {
  createControl,
  wakeWaiters,
  waitIfPaused,
  TaskCancelledError,
  type TaskControl
} from './taskControl'

export type TaskPayload = Record<string, unknown>

interface QueueItem {
  id: number
  type: TaskType
  payload: TaskPayload
}

/**
 * 任务队列：单条串行执行，进度写回 tasks 表，变更通过 'changed' 事件广播。
 * 单任务操作：取消 / 暂停 / 继续 / 重试 / 删除（能力矩阵见计划）：
 * - 排队中：暂停 / 取消 / 删除；暂停后可在队尾继续
 * - 运行中：import 可暂停（文件边界生效）与取消；convert 仅取消（杀 ffmpeg）
 * - 已暂停：继续 / 取消 / 删除
 * - 失败 / 已取消：重试（读原参数新建任务）/ 删除；已完成：删除
 */
export class TaskQueue extends EventEmitter {
  private queue: QueueItem[] = []
  /** 被暂停的排队中任务（resume 后回到队尾） */
  private pausedQueue = new Map<number, QueueItem>()
  private controls = new Map<number, TaskControl>()
  private runningId: number | null = null
  private pumpBusy = false

  private getControl(id: number): TaskControl {
    let control = this.controls.get(id)
    if (!control) {
      control = createControl()
      this.controls.set(id, control)
    }
    return control
  }

  private getStatus(id: number): Task['status'] | undefined {
    const row = getDb().prepare('SELECT status FROM tasks WHERE id = ?').get(id) as
      | { status: Task['status'] }
      | undefined
    return row?.status
  }

  enqueue(type: TaskType, payload: TaskPayload): number {
    const db = getDb()
    const res = db
      .prepare('INSERT INTO tasks (type, status, payload) VALUES (?, ?, ?)')
      .run(type, 'pending', JSON.stringify(payload))
    const id = Number(res.lastInsertRowid)
    this.queue.push({ id, type, payload })
    this.emit('changed')
    void this.pump()
    return id
  }

  /** 重试：读取原任务参数，新建一条排队任务（原记录保留以便对照） */
  retry(id: number): { ok: boolean; error?: string } {
    const row = getDb()
      .prepare('SELECT type, payload FROM tasks WHERE id = ?')
      .get(id) as { type: TaskType; payload: string | null } | undefined
    if (!row) return { ok: false, error: '任务不存在' }
    let payload: TaskPayload = {}
    try {
      const parsed = JSON.parse(row.payload ?? '{}') as unknown
      if (parsed && typeof parsed === 'object') payload = parsed as TaskPayload
    } catch {
      payload = {}
    }
    this.enqueue(row.type, payload)
    return { ok: true }
  }

  pause(id: number): { ok: boolean; error?: string } {
    const status = this.getStatus(id)
    if (!status) return { ok: false, error: '任务不存在' }
    if (status === 'done' || status === 'failed' || status === 'cancelled') {
      return { ok: false, error: '任务已结束，无法暂停' }
    }
    if (status === 'paused') return { ok: true }
    const db = getDb()
    if (id === this.runningId) {
      // 运行中：标记暂停，扫描任务在文件边界生效（convert 不允许暂停，由 UI 禁用）
      const control = this.getControl(id)
      control.paused = true
      db.prepare(
        "UPDATE tasks SET status = 'paused', message = '已暂停（当前文件完成后生效）', updated_at = datetime('now','localtime') WHERE id = ?"
      ).run(id)
      this.emit('changed')
      return { ok: true }
    }
    // 排队中：置暂停，pump 弹出时跳过
    db.prepare(
      "UPDATE tasks SET status = 'paused', updated_at = datetime('now','localtime') WHERE id = ?"
    ).run(id)
    this.emit('changed')
    return { ok: true }
  }

  resume(id: number): { ok: boolean; error?: string } {
    const status = this.getStatus(id)
    if (!status) return { ok: false, error: '任务不存在' }
    if (status !== 'paused') return { ok: false, error: '任务未处于暂停状态' }
    const db = getDb()
    const control = this.controls.get(id)
    if (id === this.runningId && control) {
      control.paused = false
      wakeWaiters(control)
      db.prepare(
        "UPDATE tasks SET status = 'running', message = NULL, updated_at = datetime('now','localtime') WHERE id = ?"
      ).run(id)
      this.emit('changed')
      return { ok: true }
    }
    // 暂停中的排队项 → 回到队尾
    const item = this.pausedQueue.get(id)
    db.prepare(
      "UPDATE tasks SET status = 'pending', updated_at = datetime('now','localtime') WHERE id = ?"
    ).run(id)
    if (item) {
      this.pausedQueue.delete(id)
      this.queue.push(item)
    } else {
      const row = db
        .prepare('SELECT type, payload FROM tasks WHERE id = ?')
        .get(id) as { type: TaskType; payload: string | null } | undefined
      if (row) {
        let payload: TaskPayload = {}
        try {
          const parsed = JSON.parse(row.payload ?? '{}') as unknown
          if (parsed && typeof parsed === 'object') payload = parsed as TaskPayload
        } catch {
          payload = {}
        }
        this.queue.push({ id, type: row.type, payload })
      }
    }
    this.emit('changed')
    void this.pump()
    return { ok: true }
  }

  cancel(id: number): { ok: boolean; error?: string } {
    const status = this.getStatus(id)
    if (!status) return { ok: false, error: '任务不存在' }
    if (status === 'done') return { ok: false, error: '任务已完成，无法取消' }
    const db = getDb()
    if (id === this.runningId) {
      // 运行中：置取消标记并唤醒暂停等待，实际终止发生在下一个文件边界 / ffmpeg 轮询
      const control = this.getControl(id)
      control.cancelled = true
      wakeWaiters(control)
      db.prepare(
        "UPDATE tasks SET status = 'cancelled', message = '正在取消…', finished_at = datetime('now','localtime'), updated_at = datetime('now','localtime') WHERE id = ?"
      ).run(id)
      this.emit('changed')
      return { ok: true }
    }
    // 排队中 / 已暂停：移出内存队列并标记
    this.queue = this.queue.filter((i) => i.id !== id)
    this.pausedQueue.delete(id)
    this.controls.delete(id)
    db.prepare(
      "UPDATE tasks SET status = 'cancelled', message = '已取消', finished_at = datetime('now','localtime'), updated_at = datetime('now','localtime') WHERE id = ?"
    ).run(id)
    this.emit('changed')
    return { ok: true }
  }

  deleteTask(id: number): { ok: boolean; error?: string } {
    const status = this.getStatus(id)
    if (status === undefined) return { ok: true } // 已不存在视为成功
    if (id === this.runningId) {
      // 删除运行中任务 = 先取消（行删除后运行收尾对已删行是无害空写）
      const control = this.getControl(id)
      control.cancelled = true
      wakeWaiters(control)
    }
    this.queue = this.queue.filter((i) => i.id !== id)
    this.pausedQueue.delete(id)
    this.controls.delete(id)
    getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id)
    this.emit('changed')
    return { ok: true }
  }

  /** 清空历史记录（仅已完成/失败/已取消；排队中与进行中不受影响） */
  clearFinished(): { ok: boolean; count: number } {
    const db = getDb()
    const rows = db
      .prepare("SELECT id FROM tasks WHERE status IN ('done','failed','cancelled')")
      .all() as { id: number }[]
    for (const r of rows) {
      this.controls.delete(r.id)
    }
    const info = db
      .prepare("DELETE FROM tasks WHERE status IN ('done','failed','cancelled')")
      .run()
    this.emit('changed')
    return { ok: true, count: Number(info.changes) }
  }

  private async pump(): Promise<void> {
    if (this.pumpBusy) return
    this.pumpBusy = true
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()!
        const status = this.getStatus(item.id)
        if (!status) continue // 已被删除
        if (status === 'paused') {
          this.pausedQueue.set(item.id, item)
          this.emit('changed')
          continue
        }
        this.runningId = item.id
        try {
          await this.runTask(item)
        } finally {
          this.runningId = null
          this.controls.delete(item.id)
        }
      }
    } finally {
      this.pumpBusy = false
    }
  }

  private async runTask(item: QueueItem): Promise<void> {
    const db = getDb()
    const control = this.getControl(item.id)
    await waitIfPaused(control)
    db.prepare(
      "UPDATE tasks SET status = 'running', started_at = datetime('now','localtime') WHERE id = ?"
    ).run(item.id)
    this.emit('changed')

    try {
      if (item.type === 'import') {
        const folderPath = item.payload.folderPath as string
        const result = await scanFolder(folderPath, {
          recursive: Boolean(item.payload.recursive),
          control,
          onProgress: (p) => {
            const progress =
              p.phase === 'probe' && p.total > 0 ? Math.min(p.current / p.total, 1) : 0
            db.prepare("UPDATE tasks SET progress = ?, message = ?, updated_at = datetime('now','localtime') WHERE id = ?")
              .run(progress, `正在分析 ${p.current}/${p.total}`, item.id)
            this.emit('changed')
          }
        })
        // 扫描完成后同步补齐本文件夹所有缺失的关键帧截图（一次性完成，避免分次扫描零散生成）
        const kf = await generateKeyframesForFolder(folderPath, control, (cur, total) => {
          db.prepare("UPDATE tasks SET progress = ?, message = ?, updated_at = datetime('now','localtime') WHERE id = ?")
            .run(Math.min(cur / total, 1), `正在生成关键帧 ${cur}/${total}`, item.id)
          this.emit('changed')
        })
        db.prepare(
          "UPDATE tasks SET status = 'done', progress = 1, message = ?, finished_at = datetime('now','localtime') WHERE id = ?"
        ).run(
          `新增 ${result.added} · 更新 ${result.updated} · 迁移 ${result.moved} · 缺失 ${result.missing} · 失败 ${result.failed} · 未变跳过 ${result.skipped}（共 ${result.totalFiles} 个文件，${(result.elapsedMs / 1000).toFixed(1)}s）· 共生成 ${kf.frames} 张关键帧`,
          item.id
        )
      } else if (item.type === 'convert') {
        const options = item.payload as unknown as ConvertOptions
        const result = await convertFile(
          options,
          (pct) => {
            db.prepare("UPDATE tasks SET progress = ?, message = ?, updated_at = datetime('now','localtime') WHERE id = ?")
              .run(pct, `转换中 ${Math.round(pct * 100)}%`, item.id)
            this.emit('changed')
          },
          control
        )
        db.prepare(
          "UPDATE tasks SET status = 'done', progress = 1, message = ?, finished_at = datetime('now','localtime') WHERE id = ?"
        ).run(`转换完成：${result.outputPath}`, item.id)
      }
    } catch (err) {
      const cancelled = err instanceof TaskCancelledError
      db.prepare(
        "UPDATE tasks SET status = ?, message = ?, finished_at = datetime('now','localtime') WHERE id = ?"
      ).run(
        cancelled ? 'cancelled' : 'failed',
        cancelled ? '任务已取消' : err instanceof Error ? err.message : String(err),
        item.id
      )
    }
    this.emit('changed')
  }
}

/** 最近任务列表（倒序） */
export function listTasks(limit = 100): Task[] {
  const rows = getDb()
    .prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT ?')
    .all(limit) as Array<Omit<Task, 'payload'> & { payload: string }>
  return rows.map((row) => {
    let payload: unknown = null
    try {
      payload = JSON.parse(row.payload)
    } catch {
      payload = row.payload
    }
    return { ...row, payload }
  })
}
