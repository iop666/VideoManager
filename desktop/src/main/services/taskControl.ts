/**
 * 任务协作取消/暂停控制（taskQueue ↔ scanner/keyframes/converter 共享）。
 * 单独成文件避免服务间循环依赖。
 */

/** 每个运行中任务的控制令牌 */
export interface TaskControl {
  cancelled: boolean
  paused: boolean
  /** 暂停等待中的 resolve（resume/cancel 时逐个唤醒） */
  waiters: Array<() => void>
}

export function createControl(): TaskControl {
  return { cancelled: false, paused: false, waiters: [] }
}

/** 任务被取消时的专用错误（队列据此标记 status = 'cancelled' 而非 failed） */
export class TaskCancelledError extends Error {
  constructor() {
    super('任务已取消')
    this.name = 'TaskCancelledError'
  }
}

/**
 * 协作检查点：已取消 → 抛 TaskCancelledError；
 * 已暂停 → 阻塞等待恢复（resume 唤醒后继续，cancel 唤醒后抛出）。
 * 各长循环（扫描文件、关键帧视频）在每个文件/视频边界调用一次。
 */
export async function waitIfPaused(control?: TaskControl): Promise<void> {
  if (!control) return
  while (control.paused && !control.cancelled) {
    await new Promise<void>((resolve) => control.waiters.push(resolve))
  }
  if (control.cancelled) throw new TaskCancelledError()
}

/** 唤醒全部暂停等待（resume / cancel 时调用） */
export function wakeWaiters(control: TaskControl): void {
  const list = control.waiters
  control.waiters = []
  for (const resolve of list) resolve()
}
