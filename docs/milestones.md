# VideoManager 阶段规划与进度

状态图例：⬜ 未开始 ｜ 🔵 进行中 ｜ ✅ 完成

| 阶段          | 主要任务                                                                  | 预计周期  | 状态                      |
| ----------- | --------------------------------------------------------------------- | ----- | ----------------------- |
| M1 基础框架     | Windows 端工程（Electron+Vue3+TS）、UI 布局、SQLite 初始化；Android 端工程（Flutter）搭建 | 2 周   | ✅ 完成                    |
| M2 导入与索引    | Windows 端扫描、ffprobe 元数据提取、缩略图生成、数据库写入                                 | 2-3 周 | ✅ 完成                    |
| M3 列表与详情    | Windows 端视频列表/搜索/详情编辑；Android 端基础 UI 与连接框架                            | 2 周   | ✅ 完成                    |
| M4 分类/标签/收藏 | 两端分类树、标签、收藏；API 落地                                                    | 1-2 周 | ✅ 完成（Windows 端全量）       |
| M5 批量重命名    | Windows 端规则引擎、预览、执行、撤销                                                | 1-2 周 | ✅ 完成                    |
| M6 播放集成     | Windows 端 PotPlayer 调用；Android 端系统播放器/ExoPlayer                       | 1 周   | ✅ 完成（工具就绪，播放数据依赖 M8/M9） |
| M7 格式转换     | Windows 端 FFmpeg 集成、转换队列                                              | 2 周   | ✅ 完成                    |
| M8 跨平台协同    | Windows 端 HTTP 服务、Android 客户端 API 对接、配对认证（契约见 `api-contract.md`）      | 2-3 周 | ✅ 完成                    |
| M9 文件传输     | 下载/断点续传/下载队列管理                                                        | 2 周   | ✅ 完成                    |
| M10 优化与测试   | 大库性能、局域网稳定性、用户测试                                                      | 2 周   | 🔵 进行中                  |
| M11 发布准备    | Windows 安装包（electron-builder）、Android APK/AAB、文档、自动更新                 | 1 周   | ⬜                       |

## 里程碑验收标准（M10）

- [x] 修复 Android「连接 PC 后索引加载失败」：连接中途（connecting/pairing）误触发列表加载导致 401，配对成功后不刷新 → 现在仅在 connected 且 api/token 变化时加载，配对后自动拉取
- [x] 修复 Android「启动即已连接时视频库为空」：init() 先于监听器注册，启动时主动同步状态
- [x] Android 列表分页加载（触底加载更多，50/页）+ 下拉刷新 + 加载更多指示器
- [x] 缩略图磁盘缓存（cached_network_image，减少重复传输）
- [x] 离线索引缓存：连接时写入 sqflite（cache_videos），断开后视频库页展示「离线缓存」列表可浏览
- [x] 配对中间态引导页（等待配对码输入）、连接失败错误详情展示
- [x] 修复 Windows 缩略图不显示：dev 模式 file:// 被 Chromium 拦截 → IPC 返回 base64（ThumbImg 组件 + 内存缓存）
- [x] **UI 美化（小米设计语言）**：Windows 端按 xiaomi-miloco design-tokens（画布 #0E0E0E/卡片 #161616/小米橙 #FF8533/圆角 12-16px/MiSans 字体/细滚动条）；Android 端按 MIUIX 风格（小米橙主题、设置页分组圆角卡片、橙色状态点横幅、卡片 12px 圆角）
- [x] **主题系统**：双端支持 跟随系统/明亮/深色 三档（持久化 + 系统主题监听），5 种配色（小米橙/蓝/绿/紫/红）一键切换（CSS 变量 + ColorScheme 工厂）
- [x] **统计区域**：Windows 新增「统计」页——总视频/总时长/总大小 + 分类分布（进度条+跳转筛选）+ 标签分布（标签云+跳转筛选）
- [x] **转换页导入制**：导入一个或多个文件或整个文件夹 → 清单（文件名/中文时长 xx分钟xx秒/文件大小/格式，可移除）；画质三档（高 CRF18 默认/中 23/低 28）；导出位置可选默认目录或文件原目录；转换完成自动入库；`--smoke-convert` 冒烟验证通过
- [ ] 大库（万级视频）性能回归验证
- [ ] 局域网断线重连与稳定性测试

## 里程碑验收标准（M7-M9）

- [x] M7 转码：mp4/mkv（H.264+AAC）/webm（VP9+Opus）、CRF 画质、等比缩放、输出目录配置、转换任务队列（进度实时）、可删源文件
- [x] M8 内置 HTTP 服务（node:http 零依赖）：health / pair / confirm / videos / videos/:id / thumbnail(ETag+304) / categories / tags / download / file(Range 断点续传) / sync/changes
- [x] M8 认证：Bearer token（SHA-256 存库）、6 位配对码（5 分钟过期、Windows 设置页实时显示）、下载令牌 TTL 内可复用（续传多请求）
- [x] M8 验证：curl + node 脚本全套 PASS（401 拦截、304 命中、错误 ETag 200、Range 206 Content-Range 正确、403MB 全量下载、dl token 续传）
- [x] M8 Android：token 持久化（shared_preferences）、连接状态机（含 pairing）、视频库/搜索接真实数据、缩略图带认证加载
- [x] M9 Android：下载管理器（并发 ≤2、.part 断点续传、暂停/恢复/取消、进度实时）、sqflite 下载记录、本地缩略图缓存、系统播放器离线播放、单删/批量删除（确认对话框含文件信息）

## 里程碑验收标准（M3-M6）

- [x] M3 视频列表：缩略图网格、搜索、分类/标签/收藏筛选、排序、分页（`videos:list` 对齐 `GET /api/videos` 契约）
- [x] M3 详情编辑：标题/分类/评分/备注/收藏/标签（抽屉式）
- [x] M3 Android：连接状态机（未连接/连接中/已连接/失败）+ Dio 网络层（按契约）+ 视频库/搜索/详情 UI 框架，真机（23046RP50C, Android 15）部署运行
- [x] M4 分类/标签 CRUD（含 videoCount）、视频分配、收藏筛选
- [x] M5 重命名规则引擎：查找替换/正则/前缀/后缀/大小写；预览+冲突检测+执行+撤销（冒烟验证：apply 3 文件 → undo 后文件系统与 DB 一致）
- [x] M6 PotPlayer：注册表/常见路径/手动配置检测，分离进程调用；Android 端 url_launcher 系统播放器工具就绪

## 里程碑验收标准（M2）

- [x] ffprobe 元数据提取（时长/分辨率/编码/音频/格式/码率）
- [x] 递归扫描 + 视频扩展名过滤；增量跳过（文件大小 + mtime 未变不重扫）
- [x] 缺失检测：磁盘删除的文件标记 `missing`，恢复后自动回归 `ready`
- [x] ffmpeg 缩略图生成（480 宽 JPEG，`<userData>/thumbnails/<id>.jpg`，仅首次生成）
- [x] 任务队列：tasks 表持久化、进度更新、完成后广播到渲染进程
- [x] 导入页（文件夹管理/扫描按钮）与任务页（实时进度）接入真数据
- [x] 冒烟验证：新增 2 / 缺失 1 / 增量跳过 1 / 任务 done（`--smoke-scan` / `--smoke-task`）

## 里程碑验收标准（M1）

- [x] `desktop/`：electron-vite 工程可 `pnpm dev` 启动，主进程 SQLite 建表成功
- [x] Windows UI：深色布局 + 侧边导航（视频库/导入/转换/任务/设置）
- [x] `android/`：Flutter 工程可 `flutter analyze` 通过，深色主题 + 底部导航 + 未连接 PC 页
- [x] `docs/api-contract.md`：REST API 契约 v0.1
- [x] `docs/data-model.md`：两端 SQLite 表结构
