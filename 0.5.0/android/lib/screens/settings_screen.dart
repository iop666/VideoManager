import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../core/theme_controller.dart';
import '../services/cache_notifier.dart';
import '../services/connection_manager.dart';
import '../services/db_helper.dart';

/// 设置页（MIUIX 风格分组卡片）：服务器配置 + 数据管理 + 外观。
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key, required this.connection});

  final ConnectionManager connection;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final TextEditingController _addressController;
  late final TextEditingController _portController;
  final TextEditingController _pairCodeController = TextEditingController();
  bool _busy = false;
  String? _pairError;
  bool _dataBusy = false;

  /// 清理离线缓存
  Future<void> _clearCache() async {
    setState(() => _dataBusy = true);
    try {
      await DbHelper.instance.clearCachedVideos();
      // 通知视频库页刷新离线缓存显示
      CacheNotifier.instance.notifyChanged();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('离线缓存已清理')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('清理失败：$e')),
        );
      }
    } finally {
      if (mounted) setState(() => _dataBusy = false);
    }
  }

  @override
  void initState() {
    super.initState();
    _addressController =
        TextEditingController(text: widget.connection.serverAddress ?? '');
    _portController =
        TextEditingController(text: widget.connection.serverPort.toString());
  }

  @override
  void dispose() {
    _addressController.dispose();
    _portController.dispose();
    _pairCodeController.dispose();
    super.dispose();
  }

  Future<void> _connect() async {
    final address = _addressController.text.trim();
    final port = int.tryParse(_portController.text.trim()) ?? 8720;
    setState(() => _busy = true);
    await widget.connection.saveServerConfig(address, port);
    await widget.connection.connect();
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _confirm() async {
    setState(() {
      _busy = true;
      _pairError = null;
    });
    final error = await widget.connection.confirmPair(_pairCodeController.text);
    if (mounted) {
      setState(() {
        _busy = false;
        _pairError = error;
      });
      if (error != null) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final status = widget.connection.status;

    return ListenableBuilder(
      listenable: widget.connection,
      builder: (context, _) {
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _sectionTitle(theme, '连接设置'),
            const SizedBox(height: 10),
            _groupCard(
              children: [
                _field(
                  theme,
                  icon: Icons.router_outlined,
                  label: '服务器地址（IP 或主机名）',
                  hint: '例如 192.168.1.100',
                  controller: _addressController,
                  enabled: status != ConnectionStatus.connecting,
                ),
                _divider(),
                _field(
                  theme,
                  icon: Icons.numbers,
                  label: '端口',
                  hint: '默认 8720',
                  controller: _portController,
                  enabled: status != ConnectionStatus.connecting,
                  numeric: true,
                ),
              ],
            ),
            const SizedBox(height: 16),
            if (status == ConnectionStatus.pairing)
              _groupCard(
                children: [
                  _pairRow(theme, _pairCodeController),
                  if (_pairError != null)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                      child: Text(
                        _pairError!,
                        style: TextStyle(color: theme.colorScheme.error, fontSize: 12),
                      ),
                    ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                    child: SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        onPressed: _busy ? null : _confirm,
                        child: Text(_busy ? '确认中...' : '确认配对'),
                      ),
                    ),
                  ),
                ],
              )
            else
              _groupCard(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                    child: SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: _busy ? null : _connect,
                        icon: _busy
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.link),
                        label: Text(_busy
                            ? '连接中...'
                            : status == ConnectionStatus.connected
                                ? '重新连接'
                                : '连接'),
                      ),
                    ),
                  ),
                  if (status == ConnectionStatus.connected)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                      child: SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          onPressed: widget.connection.disconnect,
                          icon: const Icon(Icons.link_off),
                          label: const Text('断开连接'),
                        ),
                      ),
                    )
                  else
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                      child: _statusLine(theme, status),
                    ),
                ],
              ),
            if (status == ConnectionStatus.failed &&
                widget.connection.lastError != null) ...[
              const SizedBox(height: 12),
              Text(
                widget.connection.lastError!,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.error,
                ),
              ),
            ],
            const SizedBox(height: 28),
            _sectionTitle(theme, '数据管理'),
            const SizedBox(height: 10),
            _groupCard(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 4),
                  child: Row(
                    children: [
                      Icon(Icons.storage_outlined,
                          size: 20, color: theme.colorScheme.onSurfaceVariant),
                      const SizedBox(width: 14),
                      Text('离线缓存', style: theme.textTheme.bodySmall),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 6),
                  child: Text(
                    '连接 PC 时自动同步的索引数据，可用于离线浏览',
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: theme.colorScheme.outline,
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
                  child: Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _dataBusy ? null : _clearCache,
                          icon: const Icon(Icons.delete_outline, size: 18),
                          label: const Text('清理缓存'),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 28),
            _sectionTitle(theme, '主题与配色'),
            const SizedBox(height: 10),
            _groupCard(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
                  child: Row(
                    children: [
                      Icon(Icons.brightness_6_outlined,
                          size: 20, color: theme.colorScheme.onSurfaceVariant),
                      const SizedBox(width: 14),
                      Text('主题模式', style: theme.textTheme.bodySmall),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
                  child: SegmentedButton<ThemeMode>(
                    segments: const [
                      ButtonSegment(value: ThemeMode.system, label: Text('跟随系统')),
                      ButtonSegment(value: ThemeMode.light, label: Text('明亮')),
                      ButtonSegment(value: ThemeMode.dark, label: Text('深色')),
                    ],
                    selected: {ThemeController.instance.mode},
                    onSelectionChanged: (s) => ThemeController.instance.setMode(s.first),
                    showSelectedIcon: false,
                    style: SegmentedButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                      textStyle: const TextStyle(fontSize: 13),
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
                  child: Row(
                    children: [
                      Icon(Icons.palette_outlined,
                          size: 20, color: theme.colorScheme.onSurfaceVariant),
                      const SizedBox(width: 14),
                      Text('配色', style: theme.textTheme.bodySmall),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                  child: _AccentSwatches(
                    current: ThemeController.instance.accent,
                    onChanged: (a) => ThemeController.instance.setAccent(a),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 28),
            _sectionTitle(theme, '关于'),
            const SizedBox(height: 10),
            _groupCard(
              children: [
                _aboutRow(theme, '版本', '0.2.0'),
                _divider(),
                _aboutRow(
                  theme,
                  '说明',
                  '电脑端保持运行并在同一 Wi-Fi，首次连接在电脑设置页查看配对码。',
                  multiLine: true,
                ),
              ],
            ),
            const SizedBox(height: 16),
          ],
        );
      },
    );
  }

  Widget _sectionTitle(ThemeData theme, String title) {
    return Text(
      title,
      style: theme.textTheme.titleMedium?.copyWith(color: theme.colorScheme.outline),
    );
  }

  /// MIUIX 风格分组卡片：圆角 12、主题 surface 底色、内部 hairline 分隔
  Widget _groupCard({required List<Widget> children}) {
    final theme = Theme.of(context);
    return Container(
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.colorScheme.outline),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
    );
  }

  Widget _divider() => const Divider(height: 1, indent: 16, endIndent: 16);

  Widget _field(
    ThemeData theme, {
    required IconData icon,
    required String label,
    required String hint,
    required TextEditingController controller,
    required bool enabled,
    bool numeric = false,
  }) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      child: Row(
        children: [
          Icon(icon, size: 20, color: theme.colorScheme.onSurfaceVariant),
          const SizedBox(width: 14),
          Expanded(
            child: TextField(
              controller: controller,
              enabled: enabled,
              keyboardType: numeric ? TextInputType.number : TextInputType.url,
              decoration: InputDecoration(
                hintText: hint,
                isDense: true,
                filled: false,
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                contentPadding: EdgeInsets.zero,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _pairRow(ThemeData theme, TextEditingController controller) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '在电脑端「设置 → 局域网服务」查看 6 位配对码：',
            style: theme.textTheme.bodySmall,
          ),
          const SizedBox(height: 10),
          TextField(
            controller: controller,
            keyboardType: TextInputType.number,
            maxLength: 6,
            style: const TextStyle(fontSize: 22, letterSpacing: 8, fontWeight: FontWeight.w600),
            decoration: InputDecoration(
              counterText: '',
              prefixIcon: const Icon(Icons.key, size: 20),
            ),
          ),
        ],
      ),
    );
  }

  Widget _statusLine(ThemeData theme, ConnectionStatus status) {
    final (color, text) = switch (status) {
      ConnectionStatus.disconnected => (theme.colorScheme.outline, '当前未连接'),
      ConnectionStatus.connecting => (theme.colorScheme.outline, '正在连接...'),
      ConnectionStatus.connected => (
          const Color(0xFFFF8533),
          '已连接 PC · ${widget.connection.serverAddress ?? ''}'
        ),
      ConnectionStatus.failed => (theme.colorScheme.error, '连接失败'),
      ConnectionStatus.pairing => (theme.colorScheme.outline, '等待输入配对码'),
    };
    return Row(
      children: [
        Container(
          width: 6,
          height: 6,
          decoration: BoxDecoration(
            color: color,
            shape: BoxShape.circle,
            boxShadow: [BoxShadow(color: color.withValues(alpha: 0.25), blurRadius: 6)],
          ),
        ),
        const SizedBox(width: 8),
        Text(
          text,
          style: theme.textTheme.bodySmall?.copyWith(color: color, fontWeight: FontWeight.w600),
        ),
      ],
    );
  }

  Widget _aboutRow(ThemeData theme, String label, String value, {bool multiLine = false}) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 72,
            child: Text(label, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
          ),
          Expanded(
            child: Text(
              value,
              style: theme.textTheme.bodySmall,
            ),
          ),
        ],
      ),
    );
  }
}

/// 配色选择色板（跟随当前明暗展示对应色）
class _AccentSwatches extends StatelessWidget {
  const _AccentSwatches({required this.current, required this.onChanged});

  final AccentKey current;
  final ValueChanged<AccentKey> onChanged;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      children: AccentKey.values.map((key) {
        final color = key.color(dark);
        final selected = key == current;
        return InkWell(
          onTap: () => onChanged(key),
          borderRadius: BorderRadius.circular(8),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            width: 62,
            height: 38,
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(8),
              border: selected ? Border.all(color: Theme.of(context).colorScheme.onSurface, width: 2) : null,
              boxShadow: selected ? [BoxShadow(color: color.withValues(alpha: 0.4), blurRadius: 8)] : null,
            ),
            alignment: Alignment.center,
            child: Text(
              key.name,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 11,
                fontWeight: FontWeight.w600,
                shadows: [Shadow(blurRadius: 4, color: Colors.black38)],
              ),
            ),
          ),
        );
      }).toList(),
    );
  }
}
