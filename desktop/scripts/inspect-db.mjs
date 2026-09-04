// 开发辅助：检查 VideoManager SQLite 数据库内容
// 用法：node scripts/inspect-db.mjs <db-path>
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'

const dbPath = process.argv[2]
if (!dbPath) {
  console.error('usage: node scripts/inspect-db.mjs <db-path>')
  process.exit(1)
}
if (!existsSync(dbPath)) {
  console.log(`NOT FOUND: ${dbPath}`)
  process.exit(0)
}
const d = new DatabaseSync(dbPath)
const tables = d
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((r) => r.name)
console.log(`db: ${dbPath}`)
console.log('tables:', tables.join(', '))
try {
  console.log('settings:', JSON.stringify(d.prepare('SELECT key,value FROM settings').all()))
} catch {
  /* settings 表可能不存在 */
}
console.log('journal_mode:', JSON.stringify(d.prepare('PRAGMA journal_mode').get()))
d.close()
