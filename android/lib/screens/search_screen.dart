import 'package:flutter/material.dart';
import 'package:flutter_staggered_grid_view/flutter_staggered_grid_view.dart';

import '../models/video.dart';
import '../services/connection_manager.dart';
import '../widgets/video_card.dart';
import 'video_detail_screen.dart';

/// 搜索页：搜索 Windows 端索引详细信息（标题/文件名），列表展示结果。
class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key, required this.connection});

  final ConnectionManager connection;

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final TextEditingController _controller = TextEditingController();
  List<Video>? _results;
  bool _searching = false;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _search(String keyword) async {
    final api = widget.connection.api();
    if (api == null || keyword.isEmpty) {
      setState(() {
        _results = null;
        _error = null;
      });
      return;
    }
    setState(() {
      _searching = true;
      _error = null;
    });
    try {
      final results = await api.getVideos(search: keyword, pageSize: 200);
      if (mounted) {
        setState(() {
          _results = results;
          _searching = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = '$e';
          _searching = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final connected = widget.connection.status == ConnectionStatus.connected;

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: TextField(
            controller: _controller,
            enabled: connected,
            decoration: InputDecoration(
              hintText: connected ? '搜索标题 / 文件名...' : '连接 PC 后可用',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _controller.text.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear),
                      onPressed: () {
                        _controller.clear();
                        _search('');
                      },
                    )
                  : null,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              isDense: true,
            ),
            onSubmitted: _search,
            onChanged: (_) => setState(() {}),
          ),
        ),
        Expanded(child: _buildBody(theme, connected)),
      ],
    );
  }

  Widget _buildBody(ThemeData theme, bool connected) {
    if (!connected) {
      return Center(
        child: Text('未连接 PC', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
      );
    }
    if (_searching) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(child: Text('搜索失败：$_error', style: TextStyle(color: theme.colorScheme.error)));
    }
    final results = _results;
    if (results == null) {
      return Center(
        child: Text('输入关键词开始搜索', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
      );
    }
    if (results.isEmpty) {
      return Center(child: Text('没有找到「${_controller.text}」'));
    }
    return MasonryGridView.builder(
      padding: const EdgeInsets.all(10),
      mainAxisSpacing: 10,
      crossAxisSpacing: 10,
      gridDelegate: const SliverSimpleGridDelegateWithFixedCrossAxisCount(crossAxisCount: 2),
      itemCount: results.length,
      itemBuilder: (context, i) {
        final video = results[i];
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
    );
  }
}
