import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_staggered_grid_view/flutter_staggered_grid_view.dart';

import '../models/category.dart';
import '../models/tag.dart';
import '../models/video.dart';
import '../services/api_client.dart';
import '../services/cache_notifier.dart';
import '../services/connection_manager.dart';
import '../services/db_helper.dart';
import '../widgets/video_card.dart';
import 'video_detail_screen.dart';

/// 视频库页：只获取元数据（M10 只读），支持排序/筛选/分页（每页 20）+ 底部页码。
class LibraryScreen extends StatefulWidget {
  const LibraryScreen({super.key, required this.onGoToSettings});

  final VoidCallback onGoToSettings;

  @override
  State<LibraryScreen> createState() => _LibraryScreenState();
}

class _LibraryScreenState extends State<LibraryScreen> {
  static const int _pageSize = 20;

  final ConnectionManager _connection = ConnectionManager.instance;
  ApiClient? _api;
  final List<Video> _videos = [];
  List<Video> _cachedVideos = [];
  Object? _error;
  bool _loading = false;
  int _page = 1;
  int _total = 0;
  final TextEditingController _pageInputCtrl = TextEditingController();
  /// 离线时是否展示缓存（需用户点击「恢复上次同步数据」）
  bool _showOfflineCache = false;

  // 排序与筛选（与 Windows 端一致）
  String _sortBy = 'date_added';
  String _sortDir = 'desc';
  int? _categoryId;
  int? _tagId;
  int? _authorId;
  String? _orientation;

  List<Category> _categories = [];
  List<Tag> _tags = [];

  @override
  void initState() {
    super.initState();
    _connection.addListener(_onConnectionChanged);
    // 监听缓存变更（设置页清理缓存后刷新离线显示）
    CacheNotifier.instance.version.addListener(_onCacheChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) => _onConnectionChanged());
  }

  @override
  void dispose() {
    _connection.removeListener(_onConnectionChanged);
    CacheNotifier.instance.version.removeListener(_onCacheChanged);
    _pageInputCtrl.dispose();
    super.dispose();
  }

  /// 缓存被清理/更新后：重载离线缓存并重置展示状态
  void _onCacheChanged() {
    if (!mounted) return;
    setState(() {
      _cachedVideos = [];
      _showOfflineCache = false;
    });
    _loadCached();
  }

  void _onConnectionChanged() {
    final connected = _connection.status == ConnectionStatus.connected;
    final api = _connection.api();
    if (!connected || api == null) {
      _loadCached();
      setState(() {
        _api = null;
        _videos.clear();
        _error = null;
        _page = 1;
        _total = 0;
        _showOfflineCache = false;
      });
      return;
    }
    final changed = _api == null ||
        _api!.baseUrl != api.baseUrl ||
        _api!.token != api.token;
    if (changed) {
      _api = api;
      _loadMeta();
      _reload();
    }
  }

  Future<void> _loadMeta() async {
    try {
      final api = _api;
      if (api == null) return;
      final categories = await api.getCategories();
      final tags = await api.getTags();
      if (mounted) {
        setState(() {
          _categories = categories;
          _tags = tags;
        });
      }
    } catch (_) {
      // 筛选选项加载失败不影响列表
    }
  }

  Future<void> _loadCached() async {
    try {
      final cached = await DbHelper.instance.getCachedVideos();
      if (mounted && _connection.status != ConnectionStatus.connected) {
        setState(() => _cachedVideos = cached);
      }
    } catch (_) {
      // 数据库不可用（如测试环境）时静默
    }
  }

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await _api!.getVideosPage(
        page: 1,
        pageSize: _pageSize,
        categoryId: _categoryId,
        tagId: _tagId,
        authorId: _authorId,
        orientation: _orientation,
        sortBy: _sortBy,
        sortDir: _sortDir,
      );
      if (mounted) {
        setState(() {
          _videos
            ..clear()
            ..addAll(res.items);
          _page = 1;
          _total = res.total;
          _loading = false;
        });
      }
      unawaited(DbHelper.instance.upsertCachedVideos(res.items));
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _loading = false;
        });
      }
    }
  }

  Future<void> _gotoPage(int page) async {
    if (page < 1 || page == _page) return;
    setState(() => _loading = true);
    try {
      final res = await _api!.getVideosPage(
        page: page,
        pageSize: _pageSize,
        categoryId: _categoryId,
        tagId: _tagId,
        authorId: _authorId,
        orientation: _orientation,
        sortBy: _sortBy,
        sortDir: _sortDir,
      );
      if (mounted) {
        setState(() {
          _videos
            ..clear()
            ..addAll(res.items);
          _page = page;
          _total = res.total;
          _loading = false;
        });
      }
      unawaited(DbHelper.instance.upsertCachedVideos(res.items));
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _connection,
      builder: (context, _) {
        switch (_connection.status) {
          case ConnectionStatus.disconnected:
            // 离线：不自动展示缓存，需用户点「恢复上次同步数据」才显示
            if (_showOfflineCache && _cachedVideos.isNotEmpty) return _buildOfflineCache();
            return _Guide(
              icon: Icons.desktop_windows_outlined,
              title: '设备离线',
              subtitle: '当前未连接 PC。可点击下方按钮查看上次同步的离线数据，或在设置中连接。',
              buttonText: '恢复上次同步数据',
              secondaryText: _cachedVideos.isNotEmpty ? '共 ${_cachedVideos.length} 条离线缓存' : null,
              onPressed: _cachedVideos.isNotEmpty
                  ? () => setState(() => _showOfflineCache = true)
                  : widget.onGoToSettings,
              onSecondary: _cachedVideos.isNotEmpty ? widget.onGoToSettings : null,
            );
          case ConnectionStatus.connecting:
            return const Center(child: CircularProgressIndicator());
          case ConnectionStatus.pairing:
            return _Guide(
              icon: Icons.key,
              title: '等待配对',
              subtitle: '请在设置页输入电脑端显示的 6 位配对码',
              buttonText: '去输入配对码',
              onPressed: widget.onGoToSettings,
            );
          case ConnectionStatus.failed:
            return _Guide(
              icon: Icons.link_off,
              title: '连接失败',
              subtitle: _connection.lastError ?? '请检查服务器地址与网络',
              buttonText: '去设置',
              onPressed: widget.onGoToSettings,
            );
          case ConnectionStatus.connected:
            return _buildLibrary();
        }
      },
    );
  }

  /// 离线缓存浏览（未连接时展示上次同步的清单）
  Widget _buildOfflineCache() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          color: Theme.of(context).colorScheme.surfaceContainerHighest,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            children: [
              const Icon(Icons.cloud_off, size: 16),
              const SizedBox(width: 8),
              Text(
                '离线缓存 · ${_cachedVideos.length} 个视频（上次同步）',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const Spacer(),
              TextButton(
                onPressed: widget.onGoToSettings,
                child: const Text('连接'),
              ),
            ],
          ),
        ),
        Expanded(
          child: MasonryGridView.builder(
            padding: const EdgeInsets.all(10),
            mainAxisSpacing: 10,
            crossAxisSpacing: 10,
            gridDelegate: _gridDelegate(),
            itemCount: _cachedVideos.length,
            itemBuilder: (context, i) {
              final video = _cachedVideos[i];
              return Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: VideoCard(
                  video: video,
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => VideoDetailScreen(video: video)),
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  /// 瀑布流两列（每列高度自适应内容，无下方空白）
  SliverSimpleGridDelegateWithFixedCrossAxisCount _gridDelegate() {
    return const SliverSimpleGridDelegateWithFixedCrossAxisCount(crossAxisCount: 2);
  }

  Widget _buildLibrary() {
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text('索引加载失败：$_error', textAlign: TextAlign.center),
              const SizedBox(height: 12),
              FilledButton(onPressed: _reload, child: const Text('重试')),
            ],
          ),
        ),
      );
    }
    if (_loading && _videos.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_videos.isEmpty) {
      return const Center(child: Text('视频库为空'));
    }
    final totalPages = (_total + _pageSize - 1) ~/ _pageSize;
    return RefreshIndicator(
      onRefresh: _reload,
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
              child: _buildSortBar(),
            ),
          ),
          SliverPadding(
            padding: const EdgeInsets.symmetric(horizontal: 10),
            sliver: SliverMasonryGrid(
              mainAxisSpacing: 10,
              crossAxisSpacing: 10,
              gridDelegate: _gridDelegate(),
              delegate: SliverChildBuilderDelegate(
                (context, i) => Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: VideoCard(
                    video: _videos[i],
                    onTap: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => VideoDetailScreen(video: _videos[i]),
                        ),
                      );
                    },
                  ),
                ),
                childCount: _videos.length,
              ),
            ),
          ),
          if (totalPages > 1)
            SliverToBoxAdapter(child: _buildPager(totalPages)),
          const SliverToBoxAdapter(child: SizedBox(height: 8)),
        ],
      ),
    );
  }

  /// 排序与筛选栏（与 Windows 端一致的选项）
  Widget _buildSortBar() {
    final theme = Theme.of(context);
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          _filterChip(
            theme,
            label: _sortBy == 'title'
                ? '标题'
                : _sortBy == 'duration'
                    ? '时长'
                    : _sortBy == 'rating'
                        ? '评分'
                        : _sortBy == 'file_size'
                            ? '大小'
                            : _sortBy == 'play_count'
                                ? '播放次数'
                                : '加入时间',
            onTap: () => _showSortPicker(),
          ),
          const SizedBox(width: 8),
          _filterChip(
            theme,
            label: _sortDir == 'desc' ? '降序' : '升序',
            onTap: () {
              setState(() => _sortDir = _sortDir == 'desc' ? 'asc' : 'desc');
              _reload();
            },
          ),
          const SizedBox(width: 8),
          _filterChip(
            theme,
            label: _categoryId == null ? '全部分类' : '分类：${_categoryName(_categoryId!)}',
            onTap: () => _showCategoryPicker(),
          ),
          const SizedBox(width: 8),
          _filterChip(
            theme,
            label: _tagId == null ? '全部标签' : '标签：${_tagName(_tagId!)}',
            onTap: () => _showTagPicker(),
          ),
          const SizedBox(width: 8),
          _filterChip(
            theme,
            label: _orientation == null ? '全部方向' : (_orientation == 'portrait' ? '竖屏' : '横屏'),
            onTap: () => _showOrientationPicker(),
          ),
        ],
      ),
    );
  }

  Widget _filterChip(ThemeData theme, {required String label, required VoidCallback onTap}) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color: theme.colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(label, style: theme.textTheme.labelMedium),
            const SizedBox(width: 4),
            Icon(Icons.arrow_drop_down, size: 16, color: theme.colorScheme.outline),
          ],
        ),
      ),
    );
  }

  String _categoryName(int id) =>
      _categories.firstWhere((c) => c.id == id, orElse: () => Category(id: id, name: '?', videoCount: 0)).name;

  String _tagName(int id) =>
      _tags.firstWhere((t) => t.id == id, orElse: () => Tag(id: id, name: '?', videoCount: 0)).name;

  void _showSortPicker() {
    showModalBottomSheet<void>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              title: const Text('加入时间'),
              trailing: _sortBy == 'date_added' ? const Icon(Icons.check) : null,
              onTap: () {
                setState(() => _sortBy = 'date_added');
                Navigator.pop(ctx);
                _reload();
              },
            ),
            ListTile(
              title: const Text('标题'),
              trailing: _sortBy == 'title' ? const Icon(Icons.check) : null,
              onTap: () {
                setState(() => _sortBy = 'title');
                Navigator.pop(ctx);
                _reload();
              },
            ),
            ListTile(
              title: const Text('时长'),
              trailing: _sortBy == 'duration' ? const Icon(Icons.check) : null,
              onTap: () {
                setState(() => _sortBy = 'duration');
                Navigator.pop(ctx);
                _reload();
              },
            ),
            ListTile(
              title: const Text('评分'),
              trailing: _sortBy == 'rating' ? const Icon(Icons.check) : null,
              onTap: () {
                setState(() => _sortBy = 'rating');
                Navigator.pop(ctx);
                _reload();
              },
            ),
            ListTile(
              title: const Text('文件大小'),
              trailing: _sortBy == 'file_size' ? const Icon(Icons.check) : null,
              onTap: () {
                setState(() => _sortBy = 'file_size');
                Navigator.pop(ctx);
                _reload();
              },
            ),
            ListTile(
              title: const Text('播放次数'),
              trailing: _sortBy == 'play_count' ? const Icon(Icons.check) : null,
              onTap: () {
                setState(() => _sortBy = 'play_count');
                Navigator.pop(ctx);
                _reload();
              },
            ),
          ],
        ),
      ),
    );
  }

  void _showCategoryPicker() {
    showModalBottomSheet<void>(
      context: context,
      builder: (ctx) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            ListTile(
              title: const Text('全部分类'),
              trailing: _categoryId == null ? const Icon(Icons.check) : null,
              onTap: () {
                setState(() => _categoryId = null);
                Navigator.pop(ctx);
                _reload();
              },
            ),
            ..._categories.map((c) => ListTile(
                  title: Text(c.name),
                  trailing: _categoryId == c.id ? const Icon(Icons.check) : null,
                  onTap: () {
                    setState(() => _categoryId = c.id);
                    Navigator.pop(ctx);
                    _reload();
                  },
                )),
          ],
        ),
      ),
    );
  }

  void _showTagPicker() {
    showModalBottomSheet<void>(
      context: context,
      builder: (ctx) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            ListTile(
              title: const Text('全部标签'),
              trailing: _tagId == null ? const Icon(Icons.check) : null,
              onTap: () {
                setState(() => _tagId = null);
                Navigator.pop(ctx);
                _reload();
              },
            ),
            ..._tags.map((t) => ListTile(
                  title: Text(t.name),
                  trailing: _tagId == t.id ? const Icon(Icons.check) : null,
                  onTap: () {
                    setState(() => _tagId = t.id);
                    Navigator.pop(ctx);
                    _reload();
                  },
                )),
          ],
        ),
      ),
    );
  }

  void _showOrientationPicker() {
    showModalBottomSheet<void>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              title: const Text('全部方向'),
              trailing: _orientation == null ? const Icon(Icons.check) : null,
              onTap: () {
                setState(() => _orientation = null);
                Navigator.pop(ctx);
                _reload();
              },
            ),
            ListTile(
              title: const Text('横屏'),
              trailing: _orientation == 'landscape' ? const Icon(Icons.check) : null,
              onTap: () {
                setState(() => _orientation = 'landscape');
                Navigator.pop(ctx);
                _reload();
              },
            ),
            ListTile(
              title: const Text('竖屏'),
              trailing: _orientation == 'portrait' ? const Icon(Icons.check) : null,
              onTap: () {
                setState(() => _orientation = 'portrait');
                Navigator.pop(ctx);
                _reload();
              },
            ),
          ],
        ),
      ),
    );
  }

  /// 底部页码选择（每页 20）
  Widget _buildPager(int totalPages) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          IconButton(
            onPressed: _page > 1 ? () => _gotoPage(_page - 1) : null,
            icon: const Icon(Icons.chevron_left),
          ),
          Text('第 $_page / $totalPages 页', style: theme.textTheme.bodySmall),
          const SizedBox(width: 8),
          SizedBox(
            width: 56,
            height: 32,
            child: TextField(
              controller: _pageInputCtrl,
              keyboardType: TextInputType.number,
              textAlign: TextAlign.center,
              decoration: const InputDecoration(
                isDense: true,
                border: OutlineInputBorder(),
                contentPadding: EdgeInsets.symmetric(horizontal: 6, vertical: 6),
                hintText: '页码',
              ),
              onSubmitted: (v) => _jumpToInputPage(),
            ),
          ),
          IconButton(
            onPressed: _page < totalPages ? () => _gotoPage(_page + 1) : null,
            icon: const Icon(Icons.chevron_right),
          ),
        ],
      ),
    );
  }

  void _jumpToInputPage() {
    final v = int.tryParse(_pageInputCtrl.text.trim());
    if (v == null) {
      _pageInputCtrl.clear();
      return;
    }
    _pageInputCtrl.clear();
    unawaited(_gotoPage(v));
  }
}

class _Guide extends StatelessWidget {
  const _Guide({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.buttonText,
    required this.onPressed,
    this.secondaryText,
    this.onSecondary,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final String buttonText;
  final VoidCallback onPressed;
  final String? secondaryText;
  final VoidCallback? onSecondary;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 72, color: theme.colorScheme.outline),
            const SizedBox(height: 16),
            Text(title, style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(
              subtitle,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.outline,
              ),
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: onPressed,
              icon: const Icon(Icons.link),
              label: Text(buttonText),
            ),
            if (secondaryText != null && onSecondary != null) ...[
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: onSecondary,
                icon: const Icon(Icons.settings_outlined),
                label: Text(secondaryText!),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
