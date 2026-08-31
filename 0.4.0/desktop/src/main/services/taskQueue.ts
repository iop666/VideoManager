import { EventEmitter } from 'node:events'
import { getDb } from '../db'
import type { Task, TaskType } from '../../shared/types'
import { scanFolder } from './scanner'
import { convertFile, type ConvertOptions } from './converter'

export type TaskPayload = Record<string, unknown>

interface QueueItem {
  id: number
  type: TaskType
  payload: TaskPayload
}

/** 任务队列：串行执行，进度写回 tasks 表，变更通过 'changed' 事件广播 */
export class TaskQueue extends EventEmitter {
  private queue: QueueItem[] = []
  private running = false

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

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    while (this.queue.length > 0) {
      const item = this.queue.shift()!
      await this.runTask(item)
    }
    this.running = false
  }

  private async runTask(item: QueueItem): Promise<void> {
    const db = getDb()
    db.prepare("UPDATE tasks SET status = 'running', started_at = datetime('now','localtime') WHERE id = ?")
      .run(item.id)
    this.emit('changed')

    try {
      if (item.type === 'import') {
        const result = await scanFolder(item.payload.folderPath as string, {
          recursive: Boolean(item.payload.recursive),
          onProgress: (p) => {
            const progress =
              p.phase === 'probe' && p.total > 0 ? Math.min(p.current / p.total, 1) : 0
            db.prepare('UPDATE tasks SET progress = ?, message = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?')
              .run(progress, `正在分析 ${p.current}/${p.total}`, item.id)
            this.emit('changed')
          }
        })
        db.prepare(
          "UPDATE tasks SET status = 'done', progress = 1, message = ?, finished_at = datetime('now','localtime') WHERE id = ?"
        ).run(
          `新增 ${result.added} · 更新 ${result.updated} · 迁移 ${result.moved} · 缺失 ${result.missing} · 失败 ${result.failed} · 未变跳过 ${result.skipped}（共 ${result.totalFiles} 个文件，${(result.elapsedMs / 1000).toFixed(1)}s）`,
          item.id
        )
      } else if (item.type === 'convert') {
        const options = item.payload as unknown as ConvertOptions
        const result = await convertFile(options, (pct) => {
          db.prepare('UPDATE tasks SET progress = ?, message = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?')
            .run(pct, `转换中 ${Math.round(pct * 100)}%`, item.id)
          this.emit('changed')
        })
        db.prepare(
          "UPDATE tasks SET status = 'done', progress = 1, message = ?, finished_at = datetime('now','localtime') WHERE id = ?"
        ).run(`转换完成：${result.outputPath}`, item.id)
      }
    } catch (err) {
      db.prepare(
        "UPDATE tasks SET status = 'failed', message = ?, finished_at = datetime('now','localtime') WHERE id = ?"
      ).run(err instanceof Error ? err.message : String(err), item.id)
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
