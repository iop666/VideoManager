import { getDb } from '../db'
import type { StatsSummary } from '../../shared/types'
import { findDuplicates } from './videos'

/** 视频统计汇总（总数/总时长/总大小/分类/标签/作者/横竖屏/重复） */
export function getStatsSummary(): StatsSummary {
  const db = getDb()
  const agg = db
    .prepare(
      "SELECT COUNT(*) AS total, COALESCE(SUM(duration), 0) AS duration, COALESCE(SUM(file_size), 0) AS size FROM videos WHERE status != 'missing'"
    )
    .get() as { total: number; duration: number; size: number }

  const categories = db
    .prepare(
      `SELECT c.id, c.name, COUNT(v.id) AS video_count
       FROM categories c LEFT JOIN videos v ON v.category_id = c.id AND v.status != 'missing'
       GROUP BY c.id ORDER BY video_count DESC, c.name`
    )
    .all() as unknown as Array<{ id: number; name: string; video_count: number }>

  const tags = db
    .prepare(
      `SELECT t.id, t.name, COUNT(vt.video_id) AS video_count
       FROM tags t LEFT JOIN video_tags vt ON vt.tag_id = t.id
       LEFT JOIN videos v ON v.id = vt.video_id AND v.status != 'missing'
       GROUP BY t.id ORDER BY video_count DESC, t.name`
    )
    .all() as unknown as Array<{ id: number; name: string; video_count: number }>

  const authors = db
    .prepare(
      `SELECT a.id, a.name, a.color, COUNT(v.id) AS video_count
       FROM authors a LEFT JOIN videos v ON v.author_id = a.id AND v.status != 'missing'
       GROUP BY a.id ORDER BY video_count DESC, a.name`
    )
    .all() as unknown as Array<{ id: number; name: string; color: string | null; video_count: number }>

  const orientation = db
    .prepare(
      `SELECT
         SUM(CASE WHEN width IS NOT NULL AND height IS NOT NULL AND width > height THEN 1 ELSE 0 END) AS landscape,
         SUM(CASE WHEN width IS NOT NULL AND height IS NOT NULL AND height > width THEN 1 ELSE 0 END) AS portrait,
         SUM(CASE WHEN width IS NOT NULL AND height IS NOT NULL AND width = height THEN 1 ELSE 0 END) AS square
       FROM videos WHERE status != 'missing'`
    )
    .get() as { landscape: number; portrait: number; square: number }

  const hashed = db
    .prepare(
      "SELECT COUNT(*) AS c FROM videos WHERE hash_computed = 1 AND sha256 IS NOT NULL AND status != 'missing'"
    )
    .get() as { c: number }

  return {
    totalVideos: agg.total,
    totalDuration: agg.duration,
    totalSize: agg.size,
    categories: categories.map((c) => ({ id: c.id, name: c.name, videoCount: c.video_count })),
    tags: tags.map((t) => ({ id: t.id, name: t.name, videoCount: t.video_count })),
    authors: authors.map((a) => ({ id: a.id, name: a.name, videoCount: a.video_count, color: a.color })),
    orientation: {
      landscape: orientation.landscape ?? 0,
      portrait: orientation.portrait ?? 0,
      square: orientation.square ?? 0
    },
    duplicates: findDuplicates(),
    hashedVideos: hashed.c
  }
}
