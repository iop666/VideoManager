# VideoManager — 跨平台本地视频管理与播放工具

VideoManager 是一款**本地优先**的视频管理与播放软件：**Windows 端**是主服务器，负责本地视频扫描索引、元数据管理、关键帧概览、批量重命名、格式转换、统计报表与局域网 API 服务；**Android 端**是配套客户端，通过局域网连接 Windows 端浏览视频库与元数据。所有视频与数据均保存在你自己的电脑上。

## ✨ 功能特性

### Windows 端

- **视频导入与索引**：递归扫描文件夹，自动过滤视频扩展名，用 ffprobe 提取元数据（时长/分辨率/帧率/编码/格式）并生成缩略图；以 SHA-256 作为唯一身份，支持重复检测、增量扫描（未变更文件跳过、删除文件自动标记）与文件名记录（历史文件名只读展示，移动/改名后可追溯）。
- **关键帧概览**：扫描/导入视频时按视频时长自动生成关键帧（≥300 秒 12 张 / ≥180 秒 9 张 / ≥60 秒 6 张 / ≥1 秒 3 张），统一压缩为 960px JPEG（4K 单帧仅约 90KB）；在视频库与元数据页**右键视频**即可打开关键帧抽屉（顶部显示时长/总帧数/帧率），点击小图放大、再点任意处关闭。
- **元数据管理**：为视频设置分类、标签、作者、评分、备注与收藏；分类/标签/作者均可自定义颜色（加大色板 + 选中对勾 + 全色域随机 + 当前颜色预览）并排序；元数据页支持仅本地/全部切换与编辑，下拉列表可按名称/数量正倒序排列。
- **批量重命名**：规则引擎（查找替换/正则/前缀/后缀/大小写）+ 批量修改扩展名，实时预览与冲突检测，一键执行与撤销。
- **格式转换**：FFmpeg 集成，支持单个/多个文件或整个文件夹导入，三档画质（CRF 高/中/低）等比缩放，转换队列带实时进度。
- **播放集成**：调用 PotPlayer 播放，自动检测或手动配置播放器路径。
- **封面显示模式**：视频库封面支持「横屏比例」（16:9 黑底居中）与「正常比例」切换，即时生效。
- **统计与标签管理**：总视频数/总时长/总大小，分类/标签/作者分布可视化并可点击跳转筛选；列表项带数量徽标。
- **局域网服务**：内置 HTTP 服务（Bearer Token + 6 位配对码），为 Android 端提供视频列表/详情/缩略图/分类标签等 API；**默认关闭**，开关状态自动记忆，需要时再打开。
- **主题系统**：跟随系统/明亮/深色三档，内置 **11 种中国色**配色（晴空为默认）一键切换。
- **显示范围筛选**：视频库与元数据页支持「全部 / 仅显示本地 / 仅显示收藏 / 隐藏本地」四种范围。
- **数据备份与恢复**：一键备份元数据、封面与关键帧为 ZIP（关键帧已压缩优化，备份体积小），可随时恢复，支持自动备份。
- **灵活的分页与页面体验**：每页数量自定义（2–525，默认 42）；网格/列表切换；页面缓存保留筛选条件。
- **独立「关于」页**：侧边栏直达，应用信息与版本一目了然。

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
│       │   └── services/  # 扫描/关键帧/元数据/转换/重命名/备份等服务
│       ├── preload/    # contextBridge 安全桥
│       └── renderer/   # Vue3 UI (Naive UI)：视频库/元数据/标签管理/任务/设置/关于
├── android/            # Android 端 (Flutter)
│   └── lib/
│       ├── models/     # 与 API 契约对应的数据模型
│       ├── services/   # API client / 连接管理 / 本地缓存
│       ├── screens/    # 视频库 / 搜索 / 设置
│       └── widgets/
├── shared/             # 两端共享类型契约
└── docs/
    ├── api-contract.md # REST API 契约
    └── data-model.md   # SQLite 数据模型
```

## 🚀 快速开始

### Windows 端

```bash
cd desktop
pnpm install
# 首次使用前下载 FFmpeg（元数据/缩略图/转码需要，约 100MB）：
powershell -ExecutionPolicy Bypass -File scripts/download-ffmpeg.ps1
pnpm dev          # 开发模式
pnpm build        # 构建产物到 out/
```

> FFmpeg 二进制位于 `desktop/resources/ffmpeg/`（不入库）。也可设置环境变量 `VM_FFMPEG_DIR` 指向已有 ffmpeg 目录，或加入系统 PATH。

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

最新安装包见页面右侧 [Releases](https://github.com/iop666/VideoManager/releases)：

- **Windows 免安装版**：绿色便携 zip，解压即用，运行 `VideoManager.exe`。
- **Windows 安装版**：Inno Setup 安装向导，自动创建桌面快捷方式。
- **Android 版**：安装 APK 后连接电脑即可使用。

> 数据默认保存在软件所在目录的 `data/` 子目录（绿色版/免安装场景）。若安装到 Program Files 等不可写目录，则自动回退到用户数据目录。

## 📄 文档

- [REST API 契约](docs/api-contract.md)
- [SQLite 数据模型](docs/data-model.md)

## 🔗 项目链接

- 源码仓库：https://github.com/iop666/VideoManager
