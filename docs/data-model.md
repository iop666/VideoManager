# VideoManager 数据模型（SQLite）

> Windows 端主数据库位于 `%APPDATA%/videomanager/videomanager.db`（WAL 模式）。
> Android 端本地缓存库：`videomanager_cache.db`（索引缓存 + 下载记录），仅缓存 `videos`/`categories`/`tags` 的只读副本。

## 1. Windows 端主库

### categories — 分类（支持树形）

```sql
CREATE TABLE IF NOT EXISTS categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    parent_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
```

### tags — 标签

```sql
CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);
```

### videos — 视频主表

```sql
CREATE TABLE IF NOT EXISTS videos (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT    NOT NULL,                 -- 展示标题（可手动编辑）
    file_path      TEXT    NOT NULL UNIQUE,          -- 绝对路径
    file_name      TEXT    NOT NULL,                 -- 原始文件名
    file_size      INTEGER NOT NULL DEFAULT 0,       -- 字节
    duration       REAL,                             -- 秒
    width          INTEGER,                          -- 视频宽度
    height         INTEGER,                          -- 视频高度
    codec          TEXT,                             -- 视频编码 (h264/hevc/...)
    audio_codec    TEXT,
    format         TEXT,                             -- 容器格式 (mkv/mp4/avi/...)
    category_id    INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    author         TEXT,
    rating         REAL,                             -- 0-10
    remark         TEXT,
    is_favorite    INTEGER NOT NULL DEFAULT 0,
    thumbnail_path TEXT,                             -- 缩略图缓存文件路径
    date_added     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    date_modified  TEXT,                             -- 文件 mtime
    last_played_at TEXT,
    play_count     INTEGER NOT NULL DEFAULT 0,
    status         TEXT    NOT NULL DEFAULT 'ready'  -- ready|importing|error|missing
);
CREATE INDEX IF NOT EXISTS idx_videos_category ON videos(category_id);
CREATE INDEX IF NOT EXISTS idx_videos_favorite ON videos(is_favorite);
CREATE INDEX IF NOT EXISTS idx_videos_status   ON videos(status);
```

### video_tags — 视频-标签多对多

```sql
CREATE TABLE IF NOT EXISTS video_tags (
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    tag_id   INTEGER NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
    PRIMARY KEY (video_id, tag_id)
);
```

### import_folders — 导入文件夹

```sql
CREATE TABLE IF NOT EXISTS import_folders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    path            TEXT    NOT NULL UNIQUE,
    recursive       INTEGER NOT NULL DEFAULT 1,
    enabled         INTEGER NOT NULL DEFAULT 1,
    last_scanned_at TEXT
);
```

### tasks — 任务队列（导入/缩略图/转码/重命名）

```sql
CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT    NOT NULL,       -- import|thumbnail|convert|rename
    status      TEXT    NOT NULL DEFAULT 'pending',  -- pending|running|paused|done|failed|cancelled
    payload     TEXT,                   -- JSON
    progress    REAL    NOT NULL DEFAULT 0,
    message     TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at  TEXT,
    started_at  TEXT,
    finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
```

### paired_devices — 已配对设备（Android）

```sql
CREATE TABLE IF NOT EXISTS paired_devices (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    device_name   TEXT,
    device_id     TEXT    NOT NULL UNIQUE,
    token_hash    TEXT    NOT NULL,      -- SHA-256(token)
    paired_at     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    last_seen_at  TEXT
);
```

### settings — 键值设置

```sql
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);
-- 默认值（由代码写入）：server_port=8720, thumbnail_dir=<userData>/thumbnails
```

### restore_logs — 备份恢复/回滚操作日志

```sql
CREATE TABLE IF NOT EXISTS restore_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    kind         TEXT    NOT NULL,             -- restore | rollback
    mode         TEXT,                          -- full | backup-first | local-first | missing-only
    backup_file  TEXT,
    snapshot_dir TEXT,                          -- 本次恢复创建的快照目录（回滚目标）
    summary      TEXT,                          -- 差异摘要 JSON（backupOnly/localOnly/conflict/identical…）
    stats        TEXT,                          -- 执行统计 JSON（inserted/updated/gcRemoved…）
    detail       TEXT,                          -- 逐条动作 JSON 数组 [{sha256, action}]
    result       TEXT    NOT NULL DEFAULT 'ok', -- ok | failed | rolled_back
    error        TEXT,
    elapsed_ms   INTEGER
);
```

> 安全恢复相关机制（实现于 `services/restore.ts`）：
> - 恢复前先校验备份 zip 完整性并做差异分析（不落盘）；恢复执行前自动在 `restore-snapshots/` 创建数据库快照（wal_checkpoint 后复制主库文件，封面/关键帧等图片目录共享不复制），可一键回滚。
> - 恢复对数据库的改动在单个事务内（全有或全无）；封面/关键帧属可重建文件，写入失败仅警告。
> - 回滚用快照替换整个数据库，原恢复日志行随之回到恢复前状态，因此回滚后会在快照库中写入一条 `kind='rollback'` 日志并携带原恢复信息。
> - 引用计数与物理删除分离：删除记录/恢复完成后，仅清理 sha256 引用计数归零的孤儿封面（`thumbnails/<sha256>.jpg`）与关键帧（`keyframe/Keyframe_<sha256>_NN.jpg`），用户磁盘上的视频文件永不自动删除。

## 2. Android 端本地库

### downloaded_videos — 下载记录

```sql
CREATE TABLE IF NOT EXISTS downloaded_videos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id        INTEGER NOT NULL UNIQUE,   -- 对应 Windows 端视频 ID
    local_file_path TEXT    NOT NULL,          -- 本地存储路径
    download_time   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    file_size       INTEGER
);
```

### cache_videos / cache_categories / cache_tags — 索引缓存

结构与 Windows 端对应表一致（不含 `file_path` 等敏感字段，仅含展示所需字段），`video_id` 为主键，由增量同步（`GET /api/sync/changes`）维护，支持离线浏览。

## 3. 说明

- Windows 端 `thumbnail_path` 指向 `thumbnail_dir`（`<userData>/thumbnails/<id>.jpg`），与数据库解耦，可整体删除重建。
- 删除视频记录时级联清理 `video_tags`；缩略图文件由维护任务清理。
- Android 端删除本地下载文件时同时删除 `downloaded_videos` 记录。
