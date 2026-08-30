import 'package:flutter/foundation.dart';

/// 全局缓存变更通知：设置页清理缓存后触发，视频库页监听后刷新离线缓存显示。
class CacheNotifier {
  CacheNotifier._();
  static final CacheNotifier instance = CacheNotifier._();

  final ValueNotifier<int> version = ValueNotifier<int>(0);

  /// 通知缓存已变更（清空/导入等）
  void notifyChanged() {
    version.value++;
  }
}
