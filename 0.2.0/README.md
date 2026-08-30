# VideoManager — 跨平台本地视频管理工具

VideoManager 是一款本地视频管理与播放软件：**Windows 端**作为主服务器，负责视频扫描索引、元数据管理、批量重命名、格式转换与局域网 API 服务；**Android 端**作为客户端，通过局域网连接 Windows 端浏览视频库与元数据。

## ✨ 功能特性

### Windows 端

- **视频导入与索引**：递归扫描文件夹，自动过滤视频扩展名，ffprobe 提取元数据（时长/分辨率/编码/格式），生成缩略图；增量扫描跳过未变更文件，删除的文件自动标记缺失。
- **元数据管理**：为视频设置分类、标签、作者、评分、备注与收藏；分类/标签/作者均可自定义颜色并支持拖拽/上下移动排序。
- **批量重命名**：规则引擎（查找替换/正则/前缀/后缀/大小写），实时预览 + 冲突检测，一键执行与撤销。
- **格式转换**：FFmpeg 集成，导入单个/多个文件或整个文件夹，三档画质（CRF 高/中/低），等比缩放，转换队列带实时进度。
- **播放集成**：调用 PotPlayer 播放，自动检测或手动配置播放器路径。
- **统计报表**：总视频数/总时长/总大小，分类与标签分布可视化，点击可跳转筛选。
- **局域网服务**：内置 HTTP 服务，支持 Bearer Token 认证 + 6 位配对码，提供视频列表/详情/缩略图/分类标签等 API。
- **主题系统**：跟随系统/明亮/深色三档，内置 **11 种中国色**配色（晴空为默认）一键切换。
- **显示范围筛选**：视频库与元数据页支持「全部 / 仅显示本地 / 仅显示收藏 / 隐藏本地」四种范围。
- **数据备份与恢复**：一键备份全部元数据与封面为 ZIP，可随时恢复；支持自动备份。
- **灵活的每页数量**：默认 18/30/50 或自定义 4–100，视频库与元数据页同步。

### Android 端

- 通过局域网连接 Windows 端，浏览视频库（网格/列表）、搜索、按分类/标签/作者/方向筛选、排序。
- 同步 Windows 端**全部**元数据（含离线缓存），断网后可浏览最近同步的数据。
- 支持本地与网络缩略图展示、视频详情查看。
- 跟随系统/明亮/深色主题，与 Windows 端配色一致。

## 🛠 技术栈

| 端 | 框架 | 数据库 | 说明 |
|----|------|--------|------|
| Windows | Electron + Vue 3 + TypeScript（electron-vite） | SQLite（`node:sqlite`，WAL 模式） | Naive UI、Pinia、Vue Router；内嵌 ffprobe/FFmpeg、PotPlayer、局域网 HTTP API |
| Android | Flutter 3（Material 3） | SQLite（索引缓存） | Dio HTTP 客户端、cached_network_image、flutter_staggered_grid_view |

## 📁 目录结构

```
VideoManager/
├── desktop/            # Windows 端 (Electron + Vue3 + TS)
│   └── src/
│       ├── main/       # 主进程：窗口、SQLite、IPC、局域网服务
│       │   ├── db/     # 数据库层 (schema.sql + 迁移)
│       │   └── services/  # 扫描/元数据/转换/重命名/备份等服务
│       ├── preload/    # contextBridge 安全桥
│       └── renderer/   # Vue3 UI (Naive UI)：视频库/元数据/转换/重命名/统计/任务/设置
├── android/            # Android 端 (Flutter)
│   └── lib/
│       ├── models/     # 与 API 契约对应的数据模型
│       ├── services/   # API client / 连接管理 / 本地缓存
│       ├── screens/    # 视频库 / 搜索 / 设置
│       └── widgets/
├── shared/             # 两端共享类型契约
└── docs/
    ├── api-contract.md # REST API 契约
    ├── data-model.md   # SQLite 数据模型
    └── milestones.md   # 阶段规划与进度
```

## 🚀 快速开始

### Windows 端

```bash
cd desktop
pnpm install
pnpm dev          # 开发模式
pnpm build        # 构建产物到 out/
```

> FFmpeg 二进制位于 `desktop/resources/ffmpeg/`。也可设置环境变量 `VM_FFMPEG_DIR` 指向已有 ffmpeg 目录，或加入系统 PATH。

### Android 端

```bash
cd android
flutter pub get
flutter run       # 连接 Android 设备/模拟器
```

### 局域网连接

1. 电脑与手机连接同一局域网（Wi-Fi）。
2. 在 Windows 端「设置 → 局域网服务」开启服务，记录显示的服务端口与 6 位配对码。
3. 手机打开 App，填写电脑地址与端口，输入配对码完成配对即可浏览视频库。
4. 首次启动若弹出 Windows 防火墙提示，请选择「允许访问」。

## 📦 安装包

- **Windows 免安装版**：解压即用，运行 `VideoManager.exe`。
- **Windows 安装版**：Inno Setup 安装向导，自动创建桌面快捷方式。
- **Android 版**：安装 APK 后连接电脑即可使用。

> 数据默认保存在软件所在目录的 `data/` 子目录（绿色版/免安装场景）。若安装到 Program Files 等不可写目录，则自动回退到用户数据目录。

## 📄 文档

- [REST API 契约](docs/api-contract.md)
- [SQLite 数据模型](docs/data-model.md)
- [阶段规划与进度](docs/milestones.md)

## 🔗 项目链接

- 源码仓库：https://github.com/iop666/VideoManager
