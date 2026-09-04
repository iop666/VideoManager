import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'theme.dart';

/// 主题控制（明暗/跟随系统 + 配色），持久化到 shared_preferences。
class ThemeController extends ChangeNotifier {
  ThemeController._();
  static final ThemeController instance = ThemeController._();

  ThemeMode _mode = ThemeMode.system;
  AccentKey _accent = AccentKey.sky;

  ThemeMode get mode => _mode;
  AccentKey get accent => _accent;

  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    final modeStr = prefs.getString('vm_theme_mode');
    _mode = ThemeMode.values.firstWhere(
      (m) => m.name == modeStr,
      orElse: () => ThemeMode.system,
    );
    final accentStr = prefs.getString('vm_theme_accent');
    _accent = AccentKey.values.firstWhere(
      (a) => a.name == accentStr,
      orElse: () => AccentKey.sky,
    );
    notifyListeners();
  }

  Future<void> setMode(ThemeMode mode) async {
    _mode = mode;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('vm_theme_mode', mode.name);
  }

  Future<void> setAccent(AccentKey accent) async {
    _accent = accent;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('vm_theme_accent', accent.name);
  }
}
