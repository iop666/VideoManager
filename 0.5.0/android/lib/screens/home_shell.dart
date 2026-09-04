import 'package:flutter/material.dart';

import '../services/connection_manager.dart';
import '../widgets/server_status_banner.dart';
import 'library_screen.dart';
import 'search_screen.dart';
import 'settings_screen.dart';

/// 主框架：顶部连接状态条 + 底部导航（视频 / 搜索 / 设置）。
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  final ConnectionManager _connection = ConnectionManager.instance;
  int _tabIndex = 0;

  @override
  void dispose() {
    super.dispose();
  }

  void _goToSettings() {
    setState(() => _tabIndex = 2);
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _connection,
      builder: (context, _) {
        return Scaffold(
          body: Column(
            children: [
              ServerStatusBanner(connection: _connection),
              Expanded(
                child: IndexedStack(
                  index: _tabIndex,
                  children: [
                    LibraryScreen(onGoToSettings: _goToSettings),
                    SearchScreen(connection: _connection),
                    SettingsScreen(connection: _connection),
                  ],
                ),
              ),
            ],
          ),
          bottomNavigationBar: NavigationBar(
            selectedIndex: _tabIndex,
            onDestinationSelected: (i) => setState(() => _tabIndex = i),
            destinations: const [
              NavigationDestination(
                icon: Icon(Icons.video_library_outlined),
                selectedIcon: Icon(Icons.video_library),
                label: '视频',
              ),
              NavigationDestination(
                icon: Icon(Icons.search_outlined),
                selectedIcon: Icon(Icons.search),
                label: '搜索',
              ),
              NavigationDestination(
                icon: Icon(Icons.settings_outlined),
                selectedIcon: Icon(Icons.settings),
                label: '设置',
              ),
            ],
          ),
        );
      },
    );
  }
}
