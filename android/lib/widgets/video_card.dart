import 'dart:io';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../models/video.dart';
import '../services/connection_manager.dart';
import '../utils/format.dart';

/// 视频卡片（网格 2 列：缩略图 + 标题三行 + 格式/时长/大小）。
class VideoCard extends StatelessWidget {
  const VideoCard({super.key, required this.video, this.onTap});

  final Video video;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: AspectRatio(
              aspectRatio: 16 / 9,
              child: _thumbnail(theme),
            ),
          ),
          const SizedBox(height: 6),
          // 标题：默认占用三行
          Text(
            video.title,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.bodySmall?.copyWith(
              fontWeight: FontWeight.w600,
              height: 1.3,
            ),
          ),
          const SizedBox(height: 3),
          // 格式 · 时长 · 大小
          Text(
            '${(video.format ?? '??').toUpperCase()} · ${formatDuration(video.duration)} · ${formatBytes(video.fileSize)}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.labelSmall?.copyWith(
              color: theme.colorScheme.outline,
              fontSize: 10,
            ),
          ),
        ],
      ),
    );
  }

  Widget _thumbnail(ThemeData theme) {
    // 本地封面（导入 ZIP 后存到应用目录，离线可显示）
    if (video.thumbnailUrl.isNotEmpty &&
        !video.thumbnailUrl.startsWith('/') &&
        !video.thumbnailUrl.startsWith('http')) {
      final f = File(video.thumbnailUrl);
      if (f.existsSync()) {
        return Image.file(
          f,
          fit: BoxFit.cover,
          errorBuilder: (_, _, _) => _placeholder(theme),
        );
      }
    }
    final api = ConnectionManager.instance.api();
    final fullUrl =
        api != null && video.thumbnailUrl.isNotEmpty ? api.baseUrl + video.thumbnailUrl : '';
    if (fullUrl.isEmpty) return _placeholder(theme);
    return CachedNetworkImage(
      imageUrl: fullUrl,
      httpHeaders: api?.authHeaders,
      fit: BoxFit.cover,
      placeholder: (_, _) => _placeholder(theme),
      errorWidget: (_, _, _) => _placeholder(theme),
    );
  }

  Widget _placeholder(ThemeData theme) {
    return Container(
      color: theme.colorScheme.surfaceContainerHighest,
      alignment: Alignment.center,
      child: Icon(
        video.isFavorite ? Icons.favorite : Icons.videocam_outlined,
        color: theme.colorScheme.outline,
        size: 28,
      ),
    );
  }
}
