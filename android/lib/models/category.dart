/// 分类模型（GET /api/categories）
class Category {
  final int id;
  final String name;
  final int videoCount;

  const Category({
    required this.id,
    required this.name,
    this.videoCount = 0,
  });

  factory Category.fromJson(Map<String, dynamic> json) {
    return Category(
      id: json['id'] as int,
      name: json['name'] as String? ?? '',
      videoCount: json['videoCount'] as int? ?? 0,
    );
  }
}
