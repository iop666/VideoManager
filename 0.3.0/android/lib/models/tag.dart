/// 标签模型（GET /api/tags）
class Tag {
  final int id;
  final String name;
  final int videoCount;

  const Tag({required this.id, required this.name, this.videoCount = 0});

  factory Tag.fromJson(Map<String, dynamic> json) {
    return Tag(
      id: json['id'] as int,
      name: json['name'] as String? ?? '',
      videoCount: json['videoCount'] as int? ?? 0,
    );
  }
}
