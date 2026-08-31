# VideoManager 死代码消除（DCE）日志

- 日期：2026-08-31
- 范围：desktop/（Electron 主进程 + Vue 渲染进程）+ android/（Flutter）
- 目标：零功能回归的死代码消除与体积优化
- 验证：删除前建立 typecheck/build 基线 → 删除后 desktop `tsc` + `vue-tsc` + `electron-vite build` 全绿、android `flutter analyze` + `flutter test` + `flutter build apk` 全绿

---

## 一、分析结论总览

对整个项目做了引用链静态分析（3 个并行分析：主进程 / 渲染进程 / Android），结论：

- **没有任何整文件是死代码**。所有 15 个 main 服务、6 个 store、8 个 view、4 个 component、19 个 Dart 文件均在入口链内。
- 真正可删的是**一批"确认无引用"的函数 / 字段 / 导入**，共 **23 处**（桌面 12 + Android 9 + 依赖相关 2）。
- 若干"看起来没引用"的符号（`computeSha256`、`transformName`、`getLanAddress`、`exportVideosMeta`/`attachTagsToExport`、`probeMedia` 等）**实际有内部/跨模块引用**，属于误报候选，**已保留**（遵循"宁可漏删不可误删"）。

---

## 二、桌面端（desktop/）删除明细

### 主进程（src/main/）

| 文件 | 删除项 | 类型 | 安全理由 |
|---|---|---|---|
| `src/main/index.ts` | `import { existsSync } from 'node:fs'` | 死导入 | 全文无 `existsSync(` 调用（可写性探测用 `require('node:fs').writeFileSync/rmSync`） |
| `src/main/services/httpServer.ts` | `import { join } from 'node:path'` | 死导入 | 全文路径拼接未用 `join()` |
| `src/main/services/mediaInfo.ts` | `MediaInfo.bitrate` 字段（接口声明 + `FfprobeFormat.bit_rate` + 返回值赋值） | 死字段 | grep `bitrate` 全 desktop/src 仅 mediaInfo.ts 内部命中，scanner/converter 均无 `.bitrate` 读取 |

**关键保留验证**：
- `mediaInfo.probeMedia` → 被 `scanner.ts:152`、`converter.ts:89/94/169` 引用，**保留**。
- `metaIO.exportVideosMeta` / `attachTagsToExport` → 被 `metaIO.buildLibraryExport` 内部引用，而后者被 `metaZip.buildExportZip` 引用（备份/恢复功能），**整条链保留**。

### 渲染进程（src/renderer/src/）

| 文件 | 删除项 | 类型 | 安全理由 |
|---|---|---|---|
| `stores/meta.ts` | store 方法 `addCategory` / `updateCategory` / `removeCategory` / `removeTag`（含 return 导出） | 死方法 | 仅统计页曾用，现已直连 `window.api`（带 color 参数，签名不符）；store 内零调用 |
| `stores/library.ts` | 状态 `renameOpen`（含 return 导出） | 死状态 | 旧 RenameModal 遗留弹窗开关，当前重命名为独立路由页，无消费者 |
| `utils/format.ts` | 函数 `toFileUrl` | 死函数 | 缩略图已改 IPC base64，`file://` URL 方案废弃；零调用 |
| `views/RenameView.vue` | 函数 `removeFile` + import `TrashOutline` | 死函数/死导入 | 表格无"移除单个文件"按钮（仅清空），`TrashOutline` 无图标使用 |
| `views/LibraryView.vue` | import `NButton`、`NSpace` | 死导入 | 模板只用 checkbox/select/input/spin/empty/pagination/tag/icon |
| `views/MetadataView.vue` | import `NCheckbox`、`NPopconfirm` | 死导入 | 删除确认用 `n-modal` 非这两个组件 |
| `views/ConvertView.vue` | import `NAlert` | 死导入 | 模板无 alert 提示 |
| `views/SettingsView.vue` | import `DownloadOutline` | 死导入 | 该图标仅 import 行命中，其余 7 图标均使用 |
| `components/MetaListSection.vue` | import `computed` | 死导入 | 文件只用 `ref`，无 `computed(` |
| `App.vue` | import `ref` | 死导入 | App.vue 只用 computed/h/onMounted/watch |
| `components/VideoDetailDrawer.vue` | `defineEmits` 中 `updated: [id: number]` 声明 | 死 emit 声明 | `emit('updated')` 从未调用，调用方只绑 `@close` |

### 既有类型错误修复（非新增，恢复绿基线）

| 文件 | 问题 | 修复 |
|---|---|---|
| `components/MetaListSection.vue:124` | vue-tsc 报 `editState` possibly null（内联模板箭头函数里 ref null 窄化失效） | 提取为具名函数 `onColorInput`，用 `if (!es) return` 守卫。**功能等价，仅修类型** |

---

## 三、Android 端（android/）删除明细

| 文件 | 删除项 | 类型 | 安全理由 |
|---|---|---|---|
| `services/api_client.dart` | `ApiClient.getVideo(int id)` 方法 | 死方法 | 列表/分页走 `getVideos`/`getVideosPage`，零调用点 |
| `services/api_client.dart` | `PairResult.expiresIn` 字段 | 死字段 | 解析后从未被读取 |
| `services/api_client.dart` | `ConfirmResult.serverName` / `serverVersion` 字段 | 死字段 | 解析后从未被读取（只读 `token`） |
| `services/connection_manager.dart` | `bool get isPairing` | 死 getter | UI 全部用 `status == ConnectionStatus.pairing` |
| `services/db_helper.dart` | `replaceCachedVideos(List<Video>)` 方法 | 死方法 | 注释"导入导出后调用"，该功能已移除，零调用方 |
| `models/video.dart` | `metaUpdatedAt` 字段 | 死字段 | 零读取；仅随 toJson 往返缓存，无代码读取故删除无害 |
| `models/video.dart` | `categoryId` 字段 | 死字段 | UI 零读取（`_categoryId` 是本地筛选状态变量） |
| `models/category.dart` | `parentId` 字段 | 死字段 | 解析后从未被读取 |

**保留项**：`Category.videoCount` / `Tag.videoCount` —— 被 `library_screen.dart:444/447` 兜底构造 `videoCount: 0` 引用，非零引用，**遵循红线保留**。

---

## 四、依赖清理

### 零引用依赖（用户已确认移除）

| 平台 | 依赖 | 证据 | 状态 |
|---|---|---|---|
| Android | `cupertino_icons: ^1.0.8` | lib/ 下 `CupertinoIcons` 零匹配，pubspec.lock 为 direct main | **已移除**，`flutter pub get` 后 lock 中已无（"no longer being depended on"） |

### 依赖链分析（全部保留，非死链）

| 依赖 | 使用方 | 结论 |
|---|---|---|
| desktop `fflate` | `services/metaZip.ts`（备份/恢复 ZIP） | 活跃 |
| desktop `sharp` | `scripts/generate-icons.mjs`（图标生成） | 活跃（构建工具） |
| desktop `@vicons/ionicons5` | 各 view 图标 | 活跃（10+ 引用） |
| desktop `@electron-toolkit/utils` | `main/index.ts`（setAppUserModelId/watchWindowShortcuts） | 活跃 |
| android `dio` | `api_client.dart` | 活跃 |
| android `shared_preferences` | `connection_manager`/`theme_controller` | 活跃 |
| android `sqflite` | `db_helper.dart` | 活跃 |
| android `path` | `db_helper.dart` | 活跃 |
| android `cached_network_image` | `video_card`/`video_detail` | 活跃 |
| android `flutter_staggered_grid_view` | `library`/`search` | 活跃 |
| android `path_provider`（transitive） | `cached_network_image → flutter_cache_manager` | 传递依赖，pub get 自动保留 |

---

## 五、过期测试修复（用户已确认）

`android/test/widget_test.dart` 断言过期底部标签（'视频库'/'本地视频' + '未连接 PC' 出现 2 次），与当前 HomeShell（'视频'/'搜索'/'设置' 3 个 tab）不符，运行必失败。
- 已更新断言为当前实际标签。
- `flutter test` → **All tests passed**。

---

## 六、零回归验证记录

| 检查 | 删除前 | 删除后 |
|---|---|---|
| desktop `tsc`（tsconfig.node） | 绿 | **绿** |
| desktop `vue-tsc`（tsconfig.web） | 红（MetaListSection:124 既有错误） | **绿**（已修复） |
| desktop `electron-vite build` | 绿 | **绿**（build=0） |
| android `flutter analyze` | 绿 | **绿**（No issues found） |
| android `flutter test` | 红（过期断言） | **绿**（All tests passed） |
| android `flutter build apk --debug` | 绿 | **绿**（apk=0） |

**附注**：本次修正了 `desktop/pnpm-workspace.yaml` 中 `electron-winstaller: set this to true or false` 的**占位符残留**为 `true`——否则 `electron-vite build` 的依赖状态检查（runDepsStatusCheck）会因未审批构建脚本而失败。此为构建配置修复，非功能改动。

---

## 七、统计汇总

- 可删文件：0
- 可删函数 / getter / 方法：6（桌面 meta store 4 + RenameView.removeFile 1 + Android getVideo 1）
- 可删字段：7（MediaInfo.bitrate、PairResult.expiresIn、ConfirmResult.serverName、ConfirmResult.serverVersion、Video.metaUpdatedAt、Video.categoryId、Category.parentId）
- 可删状态 / emit 声明：2（library.renameOpen、VideoDetailDrawer.updated）
- 可删导入：11（桌面 10 + Android 0）
- 可移除依赖：1（cupertino_icons）
- 过期测试修复：1（widget_test.dart）
- 既有类型错误修复：1（MetaListSection）
- 构建配置修复：1（pnpm-workspace.yaml electron-winstaller 占位符）

**红线遵守**：零功能变更；无任何签名重命名；未触碰 eval/new Function/window['xxx']/反射/DI/自动加载块；所有删除均有 grep 引用证据；含内部引用的符号（computeSha256/transformName/getLanAddress/exportVideosMeta/attachTagsToExport/probeMedia/videoCount 等）一律保留。
