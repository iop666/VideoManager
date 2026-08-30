import 'package:flutter/material.dart';

import 'core/theme.dart';
import 'core/theme_controller.dart';
import 'screens/home_shell.dart';

/// VideoManager Android 客户端根组件（动态主题：明暗 + 配色）。
class VideoManagerApp extends StatelessWidget {
  const VideoManagerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: ThemeController.instance,
      builder: (context, _) {
        final tc = ThemeController.instance;
        return MaterialApp(
          title: 'VideoManager',
          debugShowCheckedModeBanner: false,
          theme: buildTheme(brightness: Brightness.light, accentKey: tc.accent),
          darkTheme: buildTheme(brightness: Brightness.dark, accentKey: tc.accent),
          themeMode: tc.mode,
          home: const HomeShell(),
        );
      },
    );
  }
}
