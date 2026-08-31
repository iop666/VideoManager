import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api_client.dart';
import 'db_helper.dart';

/// 与 Windows 端服务器的连接状态。
enum ConnectionStatus {
  disconnected,
  connecting,
  connected,
  failed,
  /// 已发起配对，等待用户输入配对码
  pairing,
}

/// Windows 端连接管理（M8：真实配对 + token 持久化）。
class ConnectionManager extends ChangeNotifier {
  ConnectionManager._();
  static final ConnectionManager instance = ConnectionManager._();

  ConnectionStatus _status = ConnectionStatus.disconnected;
  String? _serverAddress;
  int _serverPort = 8720;
  String? _token;
  String? _deviceId;
  String? _pairId;
  String? _lastError;

  ConnectionStatus get status => _status;
  String? get serverAddress => _serverAddress;
  int get serverPort => _serverPort;
  String? get lastError => _lastError;

  /// 从本地恢复配置与 token。
  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    _serverAddress = prefs.getString('server_address');
    _serverPort = prefs.getInt('server_port') ?? 8720;
    _token = prefs.getString('token');
    _deviceId = prefs.getString('device_id');
    if (_deviceId == null) {
      _deviceId = _generateDeviceId();
      await prefs.setString('device_id', _deviceId!);
    }
    // 有 token 时验证是否仍有效（静默）
    if (_token != null && _serverAddress != null) {
      try {
        await _api().getVideos(pageSize: 1);
        _status = ConnectionStatus.connected;
        unawaited(_syncMetaSilently());
      } catch (_) {
        _token = null;
        await prefs.remove('token');
        _status = ConnectionStatus.disconnected;
      }
    }
    notifyListeners();
  }

  /// 连接成功后静默同步最新元数据清单到本地缓存（失败不阻断 UI）
  Future<void> _syncMetaSilently() async {
    try {
      final api = _api();
      final videos = await api.getMetaSync();
      await DbHelper.instance.upsertCachedVideos(videos);
      debugPrint('[connection] 元数据清单已同步：${videos.length} 条');
    } catch (e) {
      debugPrint('[connection] 元数据同步失败（忽略）：$e');
    }
  }

  /// 保存服务器地址/端口配置。
  Future<void> saveServerConfig(String address, int port) async {
    _serverAddress = address.trim();
    _serverPort = port;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('server_address', _serverAddress!);
    await prefs.setInt('server_port', port);
    notifyListeners();
  }

  /// 连接：健康检查 → 已有 token 直接验证；无 token 发起配对。
  Future<void> connect() async {
    final address = _serverAddress;
    if (address == null || address.trim().isEmpty) {
      _status = ConnectionStatus.failed;
      _lastError = '请先在设置中填写服务器地址';
      notifyListeners();
      return;
    }
    _status = ConnectionStatus.connecting;
    _lastError = null;
    notifyListeners();
    try {
      await _api().health();
    } catch (e) {
      _status = ConnectionStatus.failed;
      _lastError = '无法连接服务器：\n$e';
      notifyListeners();
      return;
    }
    if (_token != null) {
      try {
        await _api().getVideos(pageSize: 1);
        _status = ConnectionStatus.connected;
        notifyListeners();
        unawaited(_syncMetaSilently());
        return;
      } catch (_) {
        // token 失效，走配对
        final prefs = await SharedPreferences.getInstance();
        _token = null;
        await prefs.remove('token');
      }
    }
    await pairRequest();
  }

  /// 发起配对，获取 pairId（等待用户输入配对码）。
  Future<void> pairRequest() async {
    _status = ConnectionStatus.pairing;
    _lastError = null;
    notifyListeners();
    try {
      final res = await _api().pair('Android 设备');
      _pairId = res.pairId;
      _lastError = '请在电脑端查看 6 位配对码并输入';
      notifyListeners();
    } catch (e) {
      _status = ConnectionStatus.failed;
      _lastError = '配对请求失败：\n$e';
      notifyListeners();
    }
  }

  /// 输入配对码确认，成功则保存 token。
  Future<String?> confirmPair(String code) async {
    try {
      final res = await _api().confirm(
        pairId: _pairId ?? '',
        pairCode: code.trim(),
        deviceId: _deviceId ?? '',
      );
      _token = res.token;
      _pairId = null;
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('token', res.token);
      _status = ConnectionStatus.connected;
      _lastError = null;
      notifyListeners();
      unawaited(_syncMetaSilently());
      return null;
    } catch (e) {
      return '配对失败：$e';
    }
  }

  Future<void> disconnect() async {
    _status = ConnectionStatus.disconnected;
    _pairId = null;
    _lastError = null;
    notifyListeners();
  }

  /// 当前可用的 API 客户端（连接后调用）。
  ApiClient? api() {
    final address = _serverAddress;
    if (address == null || address.isEmpty) return null;
    return ApiClient('http://$address:$_serverPort', token: _token);
  }

  ApiClient _api() => ApiClient('http://$_serverAddress:$_serverPort', token: _token);

  String _generateDeviceId() {
    final rand = Random.secure();
    final hex = List.generate(16, (_) => rand.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
    return 'android-$hex';
  }
}
