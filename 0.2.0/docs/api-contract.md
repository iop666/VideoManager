# VideoManager REST API 契约（Windows ↔ Android）

> 版本：v0.1（M1 草案）｜ 实现里程碑：M8 跨平台协同
> 两端共同遵守本契约；本文件是唯一权威定义，代码实现不得偏离。

## 1. 基础约定

- **Base URL**：`http://<server-ip>:<port>`，默认端口 **8720**（可在 Windows 端设置中修改）。
- **数据格式**：请求/响应均为 JSON（UTF-8），文件流除外。
- **分页**：`page` 从 1 开始，`pageSize` 默认 50、最大 200。
- **时间**：ISO 8601 字符串（本地时区），如 `2026-08-29T14:30:00`。
- **认证**：除 `/api/auth/*`、`/api/health` 外，所有接口需携带 `Authorization: Bearer <token>`。
- **错误格式**（HTTP 4xx/5xx 时统一返回）：

```json
{
  "code": "AUTH_REQUIRED",
  "message": "需要有效的访问令牌",
  "details": {}
}
```

| 常见错误码 | 含义 |
|---|---|
| `AUTH_REQUIRED` | 未携带或携带无效 token（HTTP 401） |
| `NOT_FOUND` | 资源不存在（HTTP 404） |
| `INVALID_PARAM` | 参数校验失败（HTTP 400） |
| `PAIR_REQUIRED` | 设备未配对（HTTP 403） |
| `PAIR_EXPIRED` | 配对码已过期（HTTP 403） |
| `RATE_LIMITED` | 请求过于频繁（HTTP 429） |

## 2. 认证与配对

### 2.1 发现服务器

Android 端通过 **UDP 广播**（端口 8721）或 **mDNS**（`_videomanager._tcp`）发现局域网内的 Windows 端；也支持手动输入 IP。Windows 端广播报文为 JSON：

```json
{ "app": "videomanager", "name": "DESKTOP-ABC", "port": 8720, "version": "0.1.0" }
```

### 2.2 配对流程

```
Android                          Windows
   │  1. POST /api/auth/pair {deviceName}   │
   │───────────────────────────────────────▶│  生成 6 位配对码，有效期 5 分钟
   │  2. 用户输入配对码（或在 Windows 端弹窗确认）
   │  3. POST /api/auth/confirm {pairCode, deviceId} │
   │◀───────────────────────────────────────│  返回 token
   │  4. 后续请求携带 Authorization: Bearer <token>
```

**`POST /api/auth/pair`** — 请求配对

```json
// 请求
{ "deviceName": "Pixel 8" }
// 响应 200
{ "pairId": "a1b2c3", "expiresIn": 300 }
```

**`POST /api/auth/confirm`** — 确认配对并换取 token

```json
// 请求
{ "pairId": "a1b2c3", "pairCode": "482913", "deviceId": "android-xxxx" }
// 响应 200
{
  "token": "vm_live_xxxxxxxx",
  "serverName": "DESKTOP-ABC",
  "serverVersion": "0.1.0",
  "expiresAt": "2026-09-01T00:00:00"
}
```

**`POST /api/auth/revoke`** — 解绑设备（设备侧注销，需 Bearer token）。

## 3. 数据接口

### 3.1 视频列表

**`GET /api/videos`**

| 参数 | 类型 | 说明 |
|---|---|---|
| `page` | int | 页码，默认 1 |
| `pageSize` | int | 每页条数，默认 50，最大 200 |
| `search` | string | 标题模糊搜索 |
| `categoryId` | int | 按分类筛选 |
| `tagId` | int | 按标签筛选 |
| `favorite` | bool | 只看收藏 |
| `sortBy` | string | `date_added`（默认）\| `title` \| `duration` \| `rating` \| `file_size` |
| `sortDir` | string | `asc` \| `desc`（默认 `desc`） |

```json
// 响应 200
{
  "items": [
    {
      "id": 1,
      "title": "星际穿越 (2014)",
      "fileName": "Interstellar.2014.1080p.mkv",
      "fileSize": 18642938241,
      "duration": 10140,
      "width": 1920,
      "height": 1080,
      "format": "mkv",
      "categoryId": 3,
      "category": "电影",
      "tags": ["科幻", "IMDB8.6"],
      "rating": 8.6,
      "isFavorite": true,
      "thumbnailUrl": "/api/thumbnail/1",
      "dateAdded": "2026-08-20T10:12:00",
      "downloaded": false
    }
  ],
  "total": 1284,
  "page": 1,
  "pageSize": 50
}
```

> `downloaded` 字段由 Android 端本地状态补充（不在 Windows 端返回，见 3.6）。

### 3.2 视频详情

**`GET /api/videos/:id`** — 返回单个视频完整元数据（含 `remark`、`author`、`filePath`（仅备注用途）、`playCount`、`lastPlayedAt` 等）。

### 3.3 缩略图

**`GET /api/thumbnail/:id`**

- 响应：`image/jpeg` 二进制流。
- 缓存：响应携带 `ETag` 与 `Cache-Control: private, max-age=604800`（7 天）；Android 端应发送 `If-None-Match`，命中返回 304。
- 以视频 ID 作为 Android 本地缓存文件名。

### 3.4 分类与标签

**`GET /api/categories`**

```json
// 响应 200
{
  "items": [
    { "id": 1, "name": "电影", "parentId": null, "videoCount": 312 },
    { "id": 2, "name": "电视剧", "parentId": null, "videoCount": 540 },
    { "id": 3, "name": "科幻", "parentId": 2, "videoCount": 88 }
  ]
}
```

**`GET /api/tags`**

```json
{ "items": [ { "id": 1, "name": "科幻", "videoCount": 210 } ] }
```

### 3.5 文件下载（断点续传）

**`POST /api/download/:id`** — 请求下载，返回重定向到临时文件流地址。

```json
// 响应 202
{
  "url": "/api/file/1?token=vm_dl_xxxx",
  "expiresIn": 3600,
  "fileSize": 18642938241
}
```

**`GET /api/file/:id`**（携带下载 token 或 Bearer token）

- 支持 HTTP **Range** 请求（`Range: bytes=0-1048575`），用于断点续传。
- 响应头：`Accept-Ranges: bytes`、`Content-Length`、`Content-Type: application/octet-stream`。
- 建议 Android 端并发下载数 ≤ 2，显示实时速度与进度。

### 3.6 增量同步（索引缓存更新）

**`GET /api/sync/changes?since=<ISO8601>&page=1&pageSize=200`**

返回自 `since` 以来的变更（新视频、元数据变更、删除标记），Android 端据此更新本地索引缓存：

```json
{
  "changed": [ /* 与 /api/videos items 结构一致 */ ],
  "deletedIds": [101, 204],
  "serverTime": "2026-08-29T15:00:00",
  "hasMore": true
}
```

### 3.7 健康检查

**`GET /api/health`**（无需认证）

```json
{ "status": "ok", "version": "0.1.0", "videoCount": 1284, "dbStatus": "ready" }
```

## 4. WebSocket（可选，M8+）

`/ws`，携带 `?token=` 建立连接。Windows 端推送事件：

- `videos.changed` — 视频索引变更（触发 Android 端增量同步）
- `server.shutdown` — 服务器关闭（Android 端显示已断开）

## 5. 安全与性能

- 仅监听局域网接口（默认 0.0.0.0，可在设置中改为指定网卡）。
- token 为一次性明文存储（Windows 端 SQLite `paired_devices` 表，SHA-256 哈希后存储）。
- 缩略图在 Android 端以视频 ID 缓存，重复传输最小化。
- 列表一律分页，禁止全量拉取。
