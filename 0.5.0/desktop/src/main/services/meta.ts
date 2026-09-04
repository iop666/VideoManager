import { getDb } from '../db'
import type { Author, Category, Tag } from '../../shared/types'

// ================= 分类 =================

export function listCategories(): Category[] {
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.name, c.parent_id, c.sort_order, c.color,
              COUNT(v.id) AS video_count
       FROM categories c LEFT JOIN videos v ON v.category_id = c.id
       GROUP BY c.id ORDER BY c.sort_order, c.name`
    )
    .all() as unknown as Array<Record<string, unknown>>
  return rows.map((r) => ({
    id: r.id as number,
    name: r.name as string,
    parentId: (r.parent_id as number | null) ?? null,
    sortOrder: (r.sort_order as number) ?? 0,
    videoCount: (r.video_count as number) ?? 0,
    color: (r.color as string | null) ?? null
  }))
}

export function addCategory(
  name: string,
  parentId?: number | null,
  color?: string | null
): Category | { error: string } {
  const trimmed = name.trim()
  if (!trimmed) return { error: '分类名不能为空' }
  try {
    const res = getDb()
      .prepare('INSERT INTO categories (name, parent_id, color) VALUES (?, ?, ?)')
      .run(trimmed, parentId ?? null, color ?? null)
    const id = Number(res.lastInsertRowid)
    return { id, name: trimmed, parentId: parentId ?? null, sortOrder: 0, videoCount: 0, color: color ?? null }
  } catch {
    return { error: '分类已存在' }
  }
}

export function updateCategory(id: number, name: string, color?: string | null): { error?: string } {
  const trimmed = name.trim()
  if (!trimmed) return { error: '分类名不能为空' }
  try {
    if (color !== undefined) {
      getDb().prepare('UPDATE categories SET name = ?, color = ? WHERE id = ?').run(trimmed, color, id)
    } else {
      getDb().prepare('UPDATE categories SET name = ? WHERE id = ?').run(trimmed, id)
    }
    return {}
  } catch {
    return { error: '分类已存在' }
  }
}

export function removeCategory(id: number): void {
  getDb().prepare('DELETE FROM categories WHERE id = ?').run(id)
}

/** 分类排序：与相邻项交换 sort_order */
export function moveCategory(id: number, dir: 'up' | 'down'): void {
  const db = getDb()
  const current = db.prepare('SELECT id, sort_order FROM categories WHERE id = ?').get(id) as
    | { id: number; sort_order: number }
    | undefined
  if (!current) return
  const neighbor = (
    dir === 'up'
      ? db
          .prepare('SELECT id, sort_order FROM categories WHERE sort_order < ? ORDER BY sort_order DESC LIMIT 1')
          .get(current.sort_order)
      : db
          .prepare('SELECT id, sort_order FROM categories WHERE sort_order > ? ORDER BY sort_order ASC LIMIT 1')
          .get(current.sort_order)
  ) as { id: number; sort_order: number } | undefined
  if (!neighbor) return
  db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?').run(neighbor.sort_order, current.id)
  db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?').run(current.sort_order, neighbor.id)
}

// ================= 标签 =================

export function listTags(): Tag[] {
  const rows = getDb()
    .prepare(
      `SELECT t.id, t.name, t.color, COUNT(vt.video_id) AS video_count
       FROM tags t LEFT JOIN video_tags vt ON vt.tag_id = t.id
       GROUP BY t.id ORDER BY t.name`
    )
    .all() as unknown as Array<Record<string, unknown>>
  return rows.map((r) => ({
    id: r.id as number,
    name: r.name as string,
    videoCount: (r.video_count as number) ?? 0,
    color: (r.color as string | null) ?? null
  }))
}

export function addTag(name: string, color?: string | null): Tag | { error: string } {
  const trimmed = name.trim()
  if (!trimmed) return { error: '标签名不能为空' }
  try {
    const res = getDb().prepare('INSERT INTO tags (name, color) VALUES (?, ?)').run(trimmed, color ?? null)
    return { id: Number(res.lastInsertRowid), name: trimmed, videoCount: 0, color: color ?? null }
  } catch {
    return { error: '标签已存在' }
  }
}

export function updateTag(id: number, name: string, color?: string | null): { error?: string } {
  const trimmed = name.trim()
  if (!trimmed) return { error: '标签名不能为空' }
  try {
    if (color !== undefined) {
      getDb().prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').run(trimmed, color, id)
    } else {
      getDb().prepare('UPDATE tags SET name = ? WHERE id = ?').run(trimmed, id)
    }
    return {}
  } catch {
    return { error: '标签已存在' }
  }
}

export function removeTag(id: number): void {
  getDb().prepare('DELETE FROM tags WHERE id = ?').run(id)
}

// ================= 作者 =================

export function listAuthors(): Author[] {
  const rows = getDb()
    .prepare(
      `SELECT a.id, a.name, a.color, COUNT(v.id) AS video_count
       FROM authors a LEFT JOIN videos v ON v.author_id = a.id AND v.status != 'missing'
       GROUP BY a.id ORDER BY video_count DESC, a.name`
    )
    .all() as unknown as Array<Record<string, unknown>>
  return rows.map((r) => ({
    id: r.id as number,
    name: r.name as string,
    videoCount: (r.video_count as number) ?? 0,
    color: (r.color as string | null) ?? null
  }))
}

export function addAuthor(name: string, color?: string | null): Author | { error: string } {
  const trimmed = name.trim()
  if (!trimmed) return { error: '作者名不能为空' }
  try {
    const res = getDb().prepare('INSERT INTO authors (name, color) VALUES (?, ?)').run(trimmed, color ?? null)
    return { id: Number(res.lastInsertRowid), name: trimmed, videoCount: 0, color: color ?? null }
  } catch {
    return { error: '作者已存在' }
  }
}

export function removeAuthor(id: number): void {
  getDb().prepare('DELETE FROM authors WHERE id = ?').run(id)
}

export function updateAuthor(id: number, name: string, color?: string | null): { error?: string } {
  const trimmed = name.trim()
  if (!trimmed) return { error: '作者名不能为空' }
  try {
    if (color !== undefined) {
      getDb().prepare('UPDATE authors SET name = ?, color = ? WHERE id = ?').run(trimmed, color, id)
    } else {
      getDb().prepare('UPDATE authors SET name = ? WHERE id = ?').run(trimmed, id)
    }
    return {}
  } catch {
    return { error: '作者已存在' }
  }
}
