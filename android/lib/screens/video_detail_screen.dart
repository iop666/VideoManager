import 'dart:io';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../models/video.dart';
import '../services/connection_manager.dart';
import '../utils/format.dart';

/// 视频详情页：只读展示 PC 端索引的元数据（M10 起 Android 端只读，管理在 PC）。
class VideoDetailScreen extends StatelessWidget {
  const VideoDetailScreen({super.key, required this.video});

  final Video video;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('视频详情')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: AspectRatio(
              aspectRatio: 16 / 9,
              child: _thumbnail(theme),
            ),
          ),
          const SizedBox(height: 14),
          Text(
            video.title,
            style: theme.textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.w700,
              color: theme.colorScheme.primary,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            video.fileName,
            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline),
          ),
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _chip(theme, Icons.schedule, formatDuration(video.duration)),
              if (video.width != null && video.height != null)
                _chip(theme, Icons.aspect_ratio, '${video.width}×${video.height}'),
              if (video.format != null)
                _chip(theme, Icons.movie, video.format!.toUpperCase()),
              if (video.rating != null)
                _chip(theme, Icons.star, video.rating!.toStringAsFixed(1)),
              _chip(theme, Icons.folder_outlined, video.category ?? '未分类'),
              if (video.author != null && video.author!.isNotEmpty)
                _chip(theme, Icons.person_outline, video.author!),
              _chip(
                theme,
                Icons.stay_current_landscape,
                video.orientation == 'portrait' ? '竖屏' : '横屏',
              ),
            ],
          ),
          if (video.tags.isNotEmpty) ...[
            const SizedBox(height: 12),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: video.tags
                  .map((t) => Chip(
                        label: Text(t),
                        visualDensity: VisualDensity.compact,
                      ))
                  .toList(),
            ),
          ],
          const SizedBox(height: 24),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              children: [
                Icon(Icons.desktop_windows_outlined,
                    size: 20, color: theme.colorScheme.outline),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Android 端为只读浏览。视频下载、编辑与管理请在 PC 端操作。',
                    style: theme.textTheme.bodySmall,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          Text('详细信息', style: theme.textTheme.titleMedium),
          const SizedBox(height: 8),
          _infoRow(theme, '大小', formatBytes(video.fileSize)),
          _infoRow(theme, '编码', video.codec ?? '--'),
          _infoRow(theme, '加入时间', video.dateAdded),
          _infoRow(theme, 'SHA-256', video.sha256?.substring(0, 16) ?? '未计算（PC 端导入时计算）'),
        ],
      ),
    );
  }

  Widget _thumbnail(ThemeData theme) {
    Widget placeholder() => Container(
          color: theme.colorScheme.surfaceContainerHighest,
          alignment: Alignment.center,
          child: Icon(Icons.videocam_outlined, size: 48, color: theme.colorScheme.outline),
        );
    // 本地封面（导入 ZIP 后存到应用目录，离线可显示）
    if (video.thumbnailUrl.isNotEmpty &&
        !video.thumbnailUrl.startsWith('/') &&
        !video.thumbnailUrl.startsWith('http')) {
      final f = File(video.thumbnailUrl);
      if (f.existsSync()) {
        return Image.file(
          f,
          fit: BoxFit.cover,
          errorBuilder: (_, _, _) => placeholder(),
        );
      }
    }
    final api = ConnectionManager.instance.api();
    final fullUrl =
        api != null && video.thumbnailUrl.isNotEmpty ? api.baseUrl + video.thumbnailUrl : '';
    if (fullUrl.isEmpty) {
      return placeholder();
    }
    return CachedNetworkImage(
      imageUrl: fullUrl,
      httpHeaders: api?.authHeaders,
      fit: BoxFit.cover,
      placeholder: (_, _) => placeholder(),
      errorWidget: (_, _, _) => Container(
        color: theme.colorScheme.surfaceContainerHighest,
        alignment: Alignment.center,
        child: Icon(Icons.broken_image_outlined, size: 48, color: theme.colorScheme.outline),
      ),
    );
  }

  Widget _chip(ThemeData theme, IconData icon, String label) {
    return Chip(
      avatar: Icon(icon, size: 16, color: theme.colorScheme.primary),
      label: Text(label),
      visualDensity: VisualDensity.compact,
    );
  }

  Widget _infoRow(ThemeData theme, String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 80,
            child: Text(
              label,
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline),
            ),
          ),
          Expanded(child: Text(value, style: theme.textTheme.bodySmall)),
        ],
      ),
    );
  }
}
