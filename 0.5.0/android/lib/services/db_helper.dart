import 'dart:convert';

import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import '../models/video.dart';

/// 本地 SQLite 缓存（离线索引缓存），结构与 docs/data-model.md 一致。
class DbHelper {
  DbHelper._();
  static final DbHelper instance = DbHelper._();

  Database? _db;

  Future<Database> get database async => _db ??= await _open();

  Future<Database> _open() async {
    final dir = await getDatabasesPath();
    return openDatabase(
      p.join(dir, 'videomanager_cache.db'),
      version: 2,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE IF NOT EXISTS cache_videos (
            video_id INTEGER PRIMARY KEY,
            data TEXT NOT NULL,
            cached_at TEXT DEFAULT (datetime('now','localtime'))
          )
        ''');
      },
      onUpgrade: (db, oldVersion, newVersion) async {
        if (oldVersion < 2) {
          await db.execute('''
            CREATE TABLE IF NOT EXISTS cache_videos (
              video_id INTEGER PRIMARY KEY,
              data TEXT NOT NULL,
              cached_at TEXT DEFAULT (datetime('now','localtime'))
            )
          ''');
        }
        // 清理已废弃的下载记录表（下载功能已移除）
        try {
          await db.execute('DROP TABLE IF EXISTS downloaded_videos');
        } catch (_) {
          /* ignore */
        }
      },
    );
  }

  // ============ 索引缓存（离线浏览） ============

  /// 写入/更新索引缓存（连接时拉取后调用）
  Future<void> upsertCachedVideos(List<Video> videos) async {
    final db = await database;
    final batch = db.batch();
    for (final v in videos) {
      batch.insert(
        'cache_videos',
        {
          'video_id': v.id,
          'data': jsonEncode(v.toJson()),
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    }
    await batch.commit(noResult: true);
  }

  /// 读取离线索引缓存
  Future<List<Video>> getCachedVideos() async {
    final db = await database;
    final rows = await db.query('cache_videos', orderBy: 'video_id DESC');
    return rows
        .map((r) => Video.fromJson(jsonDecode(r['data'] as String) as Map<String, dynamic>))
        .toList();
  }

  /// 清空离线索引缓存
  Future<void> clearCachedVideos() async {
    final db = await database;
    await db.delete('cache_videos');
  }
}
