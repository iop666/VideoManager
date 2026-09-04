-- ============================================================
-- VideoManager Windows 端主数据库 Schema v0.1 (M1)
-- 权威定义见 docs/data-model.md；修改需同步更新该文档。
-- 数据库文件：%APPDATA%/videomanager/videomanager.db (WAL 模式)
-- ============================================================

-- 分类（支持树形）
CREATE TABLE IF NOT EXISTS categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    parent_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    color      TEXT,
    created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 标签
CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT
);

-- 作者
CREATE TABLE IF NOT EXISTS authors (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    color      TEXT,
    created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 视频主表
CREATE TABLE IF NOT EXISTS videos (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT    NOT NULL,
    file_path      TEXT    NOT NULL UNIQUE,
    file_name      TEXT    NOT NULL,
    -- 历史文件名记录（JSON 数组）：同一 SHA-256 身份导入时见过的全部文件名，自动记录、用户不可修改
    more_file_names TEXT   NOT NULL DEFAULT '[]',
    file_size      INTEGER NOT NULL DEFAULT 0,
    duration       REAL,
    width          INTEGER,
    height         INTEGER,
    codec          TEXT,
    audio_codec    TEXT,
    format         TEXT,
    -- 视频帧率（关键帧截图换算帧号用；ffprobe avg_frame_rate 解析）
    fps            REAL,
    -- 视频总帧数（时长 × 帧率取整，导出备份时记录）
    frame_count    INTEGER,
    -- 关键帧截图记录（JSON 数组：[{ name, timeSec, frameNo }]，扫描时自动生成）
    keyframes      TEXT    NOT NULL DEFAULT '[]',
    category_id    INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    author         TEXT,
    author_id      INTEGER REFERENCES authors(id) ON DELETE SET NULL,
    rating         REAL,
    remark         TEXT,
    is_favorite    INTEGER NOT NULL DEFAULT 0,
    thumbnail_path TEXT,
    -- SHA-256 唯一身份（导入时计算；hash_computed=1 表示已建立身份记录）
    sha256         TEXT,
    hash_computed  INTEGER NOT NULL DEFAULT 0,
    date_added     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    date_modified  TEXT,
    last_played_at TEXT,
    play_count     INTEGER NOT NULL DEFAULT 0,
    status         TEXT    NOT NULL DEFAULT 'ready'
);
CREATE INDEX IF NOT EXISTS idx_videos_category ON videos(category_id);
CREATE INDEX IF NOT EXISTS idx_videos_favorite ON videos(is_favorite);
CREATE INDEX IF NOT EXISTS idx_videos_status   ON videos(status);
-- 注意：idx_videos_sha256 / idx_videos_author 在 db/index.ts 迁移中创建（老库列不存在）

-- 视频-标签多对多
CREATE TABLE IF NOT EXISTS video_tags (
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    tag_id   INTEGER NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
    PRIMARY KEY (video_id, tag_id)
);

-- 导入文件夹
CREATE TABLE IF NOT EXISTS import_folders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    path            TEXT    NOT NULL UNIQUE,
    recursive       INTEGER NOT NULL DEFAULT 1,
    enabled         INTEGER NOT NULL DEFAULT 1,
    last_scanned_at TEXT
);

-- 任务队列（import/thumbnail/convert/rename）
CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'pending',
    payload     TEXT,
    progress    REAL    NOT NULL DEFAULT 0,
    message     TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at  TEXT,
    started_at  TEXT,
    finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- 已配对设备（Android 端）
CREATE TABLE IF NOT EXISTS paired_devices (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    device_name  TEXT,
    device_id    TEXT NOT NULL UNIQUE,
    token_hash   TEXT NOT NULL,
    paired_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    last_seen_at TEXT
);

-- 键值设置
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- 默认设置
INSERT OR IGNORE INTO settings (key, value) VALUES ('server_port', '8720');
INSERT OR IGNORE INTO settings (key, value) VALUES ('schema_version', '1');
