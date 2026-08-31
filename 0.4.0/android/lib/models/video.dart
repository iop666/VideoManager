/// 视频模型（与 docs/api-contract.md 的 GET /api/videos items 字段对齐）
class Video {
  final int id;
  final String title;
  final String fileName;
  final int fileSize;
  final double? duration;
  final int? width;
  final int? height;
  final String? codec;
  final String? format;
  final String? category;
  final List<String> tags;
  final double? rating;
  final bool isFavorite;
  final String thumbnailUrl;
  final String dateAdded;
  final String? author;
  final String? orientation;
  final String? sha256;

  const Video({
    required this.id,
    required this.title,
    required this.fileName,
    required this.fileSize,
    this.duration,
    this.width,
    this.height,
    this.codec,
    this.format,
    this.category,
    this.tags = const [],
    this.rating,
    this.isFavorite = false,
    this.thumbnailUrl = '',
    this.dateAdded = '',
    this.author,
    this.orientation,
    this.sha256,
  });

  factory Video.fromJson(Map<String, dynamic> json) {
    return Video(
      id: json['id'] as int,
      title: json['title'] as String? ?? '',
      fileName: json['fileName'] as String? ?? '',
      fileSize: json['fileSize'] as int? ?? 0,
      duration: (json['duration'] as num?)?.toDouble(),
      width: json['width'] as int?,
      height: json['height'] as int?,
      codec: json['codec'] as String?,
      format: json['format'] as String?,
      category: json['category'] as String?,
      tags: (json['tags'] as List?)?.cast<String>() ?? [],
      rating: (json['rating'] as num?)?.toDouble(),
      isFavorite: json['isFavorite'] as bool? ?? false,
      thumbnailUrl: json['thumbnailUrl'] as String? ?? '',
      dateAdded: json['dateAdded'] as String? ?? '',
      author: json['author'] as String?,
      orientation: json['orientation'] as String?,
      sha256: json['sha256'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'fileName': fileName,
        'fileSize': fileSize,
        'duration': duration,
        'width': width,
        'height': height,
        'codec': codec,
        'format': format,
        'category': category,
        'tags': tags,
        'rating': rating,
        'isFavorite': isFavorite,
        'thumbnailUrl': thumbnailUrl,
        'dateAdded': dateAdded,
        'author': author,
        'orientation': orientation,
        'sha256': sha256,
      };
}
