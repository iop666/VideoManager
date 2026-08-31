/// 时长格式化：1234 秒 → "20:34" / "2:03:14"
String formatDuration(double? sec) {
  if (sec == null || !sec.isFinite) return '--:--';
  final s = sec.floor();
  final h = s ~/ 3600;
  final m = (s % 3600) ~/ 60;
  final r = s % 60;
  final mm = m.toString().padLeft(2, '0');
  final ss = r.toString().padLeft(2, '0');
  return h > 0 ? '$h:$mm:$ss' : '$m:$ss';
}

/// 文件大小格式化
String formatBytes(int? bytes) {
  if (bytes == null) return '--';
  if (bytes < 1024) return '$bytes B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  double v = bytes.toDouble();
  var u = -1;
  do {
    v /= 1024;
    u++;
  } while (v >= 1024 && u < units.length - 1);
  return '${v >= 100 ? v.toStringAsFixed(0) : v.toStringAsFixed(1)} ${units[u]}';
}
