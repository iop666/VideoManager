import 'package:flutter/material.dart';

import '../services/connection_manager.dart';

/// 顶部服务器连接状态条（小米风格：橙色连接态 / 红色断连态）。
class ServerStatusBanner extends StatelessWidget {
  const ServerStatusBanner({super.key, required this.connection});

  final ConnectionManager connection;

  @override
  Widget build(BuildContext context) {
    final connected = connection.status == ConnectionStatus.connected;
    final color = connected ? const Color(0xFFFF8533) : const Color(0xFFDC2626);
    final server = connection.serverAddress;
    final text = connected
        ? (server != null && server.isNotEmpty ? '已连接 PC · $server' : '已连接 PC')
        : '未连接 PC';

    return Material(
      color: color.withValues(alpha: 0.10),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            children: [
              Container(
                width: 6,
                height: 6,
                decoration: BoxDecoration(
                  color: color,
                  shape: BoxShape.circle,
                  boxShadow: [
                    BoxShadow(color: color.withValues(alpha: 0.35), blurRadius: 6),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  text,
                  style: TextStyle(
                    color: color,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
