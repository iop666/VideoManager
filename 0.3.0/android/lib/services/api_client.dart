import 'package:dio/dio.dart';

import '../models/category.dart';
import '../models/tag.dart';
import '../models/video.dart';

/// 配对结果
class PairResult {
  const PairResult({required this.pairId});
  final String pairId;

  factory PairResult.fromJson(Map<String, dynamic> json) => PairResult(
        pairId: json['pairId'] as String? ?? '',
      );
}

/// 确认配对结果
class ConfirmResult {
  const ConfirmResult({required this.token});
  final String token;

  factory ConfirmResult.fromJson(Map<String, dynamic> json) => ConfirmResult(
        token: json['token'] as String? ?? '',
      );
}

/// 分页视频结果（items + total）
class VideoPage {
  const VideoPage({required this.items, required this.total});
  final List<Video> items;
  final int total;
}

/// Windows 端 REST API 客户端（契约见 docs/api-contract.md，M8 已联调）。
class ApiClient {
  ApiClient(this.baseUrl, {this.token});

  final String baseUrl;
  final String? token;

  Dio get _dio => Dio(
        BaseOptions(
          baseUrl: baseUrl,
          connectTimeout: const Duration(seconds: 8),
          receiveTimeout: const Duration(seconds: 30),
          headers: {
            if (token != null) 'Authorization': 'Bearer $token',
          },
        ),
      );

  /// GET /api/health
  Future<Map<String, dynamic>> health() async {
    final res = await _dio.get('/api/health');
    return res.data as Map<String, dynamic>;
  }

  /// POST /api/auth/pair — 发起配对，返回 pairId
  Future<PairResult> pair(String deviceName) async {
    final res = await _dio.post('/api/auth/pair', data: {'deviceName': deviceName});
    return PairResult.fromJson(res.data as Map<String, dynamic>);
  }

  /// POST /api/auth/confirm — 输入配对码换取 token
  Future<ConfirmResult> confirm({
    required String pairId,
    required String pairCode,
    required String deviceId,
  }) async {
    final res = await _dio.post('/api/auth/confirm', data: {
      'pairId': pairId,
      'pairCode': pairCode,
      'deviceId': deviceId,
    });
    return ConfirmResult.fromJson(res.data as Map<String, dynamic>);
  }

  /// GET /api/videos（返回分页结果：items + total）
  Future<VideoPage> getVideosPage({
    int page = 1,
    int pageSize = 100,
    String? search,
    int? categoryId,
    int? tagId,
    int? authorId,
    String? orientation,
    bool? favorite,
    String? sortBy,
    String? sortDir,
    bool includeMissing = true,
  }) async {
    final res = await _dio.get('/api/videos', queryParameters: {
      'page': page,
      'pageSize': pageSize,
      'search': ?search,
      'categoryId': ?categoryId,
      'tagId': ?tagId,
      'authorId': ?authorId,
      'orientation': ?orientation,
      'favorite': ?favorite,
      'sortBy': ?sortBy,
      'sortDir': ?sortDir,
      'includeMissing': includeMissing,
    });
    final data = res.data as Map<String, dynamic>;
    return VideoPage(
      items: (data['items'] as List)
          .map((e) => Video.fromJson(e as Map<String, dynamic>))
          .toList(),
      total: data['total'] as int? ?? 0,
    );
  }

  /// GET /api/videos（仅列表，兼容旧调用）
  Future<List<Video>> getVideos({
    int page = 1,
    int pageSize = 100,
    String? search,
    int? categoryId,
    int? tagId,
    bool? favorite,
    String? sortBy,
    String? sortDir,
  }) async {
    final res = await getVideosPage(
      page: page,
      pageSize: pageSize,
      search: search,
      categoryId: categoryId,
      tagId: tagId,
      favorite: favorite,
      sortBy: sortBy,
      sortDir: sortDir,
    );
    return res.items;
  }

  /// GET /api/meta/sync — 全量元数据清单（打开 App 时自动同步最新视频清单）
  Future<List<Video>> getMetaSync() async {
    final res = await _dio.get('/api/meta/sync');
    final data = res.data as Map<String, dynamic>;
    return (data['items'] as List)
        .map((e) => Video.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /api/categories
  Future<List<Category>> getCategories() async {
    final res = await _dio.get('/api/categories');
    final data = res.data as Map<String, dynamic>;
    return (data['items'] as List)
        .map((e) => Category.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /api/tags
  Future<List<Tag>> getTags() async {
    final res = await _dio.get('/api/tags');
    final data = res.data as Map<String, dynamic>;
    return (data['items'] as List)
        .map((e) => Tag.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// 缩略图请求头（Image.network(headers:)）
  Map<String, String> get authHeaders =>
      {if (token != null) 'Authorization': 'Bearer $token'};
}
