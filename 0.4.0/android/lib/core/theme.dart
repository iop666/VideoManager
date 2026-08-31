import 'package:flutter/material.dart';

/// 配色方案（与 Windows 端 theme.ts 的 ACCENTS 对应，中国色命名）
enum AccentKey {
  amber,
  sky,
  bamboo,
  mist,
  cinnabar,
  rouge,
  ultramarine,
  indigo,
  ochre,
  lotus,
  pines,
}

extension AccentInfo on AccentKey {
  String get name => switch (this) {
        AccentKey.amber => '琥珀',
        AccentKey.sky => '晴空',
        AccentKey.bamboo => '竹影',
        AccentKey.mist => '烟霞',
        AccentKey.cinnabar => '朱砂',
        AccentKey.rouge => '胭脂',
        AccentKey.ultramarine => '群青',
        AccentKey.indigo => '黛蓝',
        AccentKey.ochre => '赭石',
        AccentKey.lotus => '藕荷',
        AccentKey.pines => '松花',
      };

  Color color(bool dark) => switch (this) {
        AccentKey.amber =>
          dark ? const Color(0xFFFF8533) : const Color(0xFFD97014),
        AccentKey.sky =>
          dark ? const Color(0xFF5B9BFF) : const Color(0xFF2563EB),
        AccentKey.bamboo =>
          dark ? const Color(0xFF3ECF6E) : const Color(0xFF2E9E57),
        AccentKey.mist =>
          dark ? const Color(0xFFA78BFA) : const Color(0xFF7C5CF0),
        AccentKey.cinnabar =>
          dark ? const Color(0xFFFF6B5E) : const Color(0xFFC3272B),
        AccentKey.rouge =>
          dark ? const Color(0xFFFF7A9E) : const Color(0xFF9D2933),
        AccentKey.ultramarine =>
          dark ? const Color(0xFF4FB3C9) : const Color(0xFF2E7D8F),
        AccentKey.indigo =>
          dark ? const Color(0xFF7C90C0) : const Color(0xFF425066),
        AccentKey.ochre =>
          dark ? const Color(0xFFD08B5A) : const Color(0xFF85431E),
        AccentKey.lotus =>
          dark ? const Color(0xFFF0A8BB) : const Color(0xFFB76E79),
        AccentKey.pines =>
          dark ? const Color(0xFFF2D24A) : const Color(0xFFB8911B),
      };
}

/// 小米设计语言主题（参考 xiaomi-miloco design-tokens 与 MIUIX 风格）。
/// 画布/卡片/文字按明暗切换，accent 可选配色。
ThemeData buildTheme({required Brightness brightness, required AccentKey accentKey}) {
  final bool dark = brightness == Brightness.dark;
  final Color accent = accentKey.color(dark);

  final Color canvas = dark ? const Color(0xFF0E0E0E) : const Color(0xFFF4F5F7);
  final Color surface = dark ? const Color(0xFF161616) : const Color(0xFFFFFFFF);
  final Color hover = dark ? const Color(0xFF1F1F1F) : const Color(0xFFEBEDEF);
  final Color border = dark ? const Color(0xFF2A2A2A) : const Color(0xFFE5E5E5);
  final Color borderStrong = dark ? const Color(0xFF3A3A3A) : const Color(0xFFCCCCCC);
  final Color textPrimary = dark ? const Color(0xFFF5F5F5) : const Color(0xFF1F1F1F);
  final Color textSecondary = dark ? const Color(0xFFB5B5B5) : const Color(0xFF6B6B6B);
  final Color textTertiary = dark ? const Color(0xFF888888) : const Color(0xFF9A9A9A);
  final Color textDisabled = dark ? const Color(0xFF555555) : const Color(0xFFC5C5C5);

  const radiusCard = 12.0;
  const radiusDialog = 16.0;
  const radiusControl = 8.0;

  final scheme = ColorScheme.fromSeed(
    seedColor: accent,
    brightness: brightness,
    surface: surface,
  ).copyWith(
    primary: accent,
    onPrimary: dark ? const Color(0xFF1F1F1F) : Colors.white,
    primaryContainer: accent.withValues(alpha: 0.14),
    onPrimaryContainer: accent,
    secondary: accent,
    surface: surface,
    onSurface: textPrimary,
    onSurfaceVariant: textSecondary,
    outline: border,
    outlineVariant: borderStrong,
    error: const Color(0xFFDC2626),
    onError: Colors.white,
    surfaceContainerHighest: hover,
    surfaceContainerHigh: hover,
    surfaceContainer: surface,
    surfaceContainerLow: surface,
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    brightness: brightness,
    scaffoldBackgroundColor: canvas,
    fontFamily: null, // 使用系统字体（小米设备即为 MiSans）
    textTheme: TextTheme(
      titleLarge: TextStyle(
        fontSize: 20,
        fontWeight: FontWeight.w600,
        letterSpacing: -0.005,
        color: textPrimary,
      ),
      titleMedium: TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w600,
        letterSpacing: -0.005,
        color: textPrimary,
      ),
      titleSmall: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: textPrimary),
      bodyMedium: TextStyle(fontSize: 14, color: textPrimary),
      bodySmall: TextStyle(fontSize: 13, color: textSecondary),
      labelSmall: TextStyle(fontSize: 11, color: textTertiary),
      labelMedium: TextStyle(fontSize: 12, color: textSecondary),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: canvas,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        fontSize: 17,
        fontWeight: FontWeight.w600,
        color: textPrimary,
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: surface,
      surfaceTintColor: Colors.transparent,
      indicatorColor: accent.withValues(alpha: 0.16),
      height: 64,
      labelTextStyle: WidgetStateProperty.resolveWith(
        (states) => TextStyle(
          fontSize: 11,
          fontWeight: states.contains(WidgetState.selected) ? FontWeight.w600 : FontWeight.w400,
          color: states.contains(WidgetState.selected) ? accent : textTertiary,
        ),
      ),
      iconTheme: WidgetStateProperty.resolveWith(
        (states) => IconThemeData(
          color: states.contains(WidgetState.selected) ? accent : textTertiary,
          size: 24,
        ),
      ),
    ),
    cardTheme: CardThemeData(
      color: surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(radiusCard),
        side: BorderSide(color: border, width: 1),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radiusDialog)),
      titleTextStyle: TextStyle(
        fontSize: 17,
        fontWeight: FontWeight.w600,
        color: textPrimary,
      ),
      contentTextStyle: TextStyle(fontSize: 14, color: textSecondary),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: accent,
        foregroundColor: dark ? const Color(0xFF1F1F1F) : Colors.white,
        disabledBackgroundColor: border,
        disabledForegroundColor: textDisabled,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radiusControl)),
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: textPrimary,
        side: BorderSide(color: borderStrong),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radiusControl)),
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: accent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radiusControl)),
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: hover,
      selectedColor: accent.withValues(alpha: 0.16),
      labelStyle: TextStyle(fontSize: 12, color: textSecondary),
      secondaryLabelStyle: TextStyle(fontSize: 12, color: accent),
      side: BorderSide(color: border),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: surface,
      hintStyle: TextStyle(color: textTertiary, fontSize: 14),
      labelStyle: TextStyle(color: textSecondary, fontSize: 14),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(radiusControl),
        borderSide: BorderSide(color: border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(radiusControl),
        borderSide: BorderSide(color: border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(radiusControl),
        borderSide: BorderSide(color: accent, width: 1.5),
      ),
    ),
    listTileTheme: ListTileThemeData(
      iconColor: textSecondary,
      textColor: textPrimary,
      subtitleTextStyle: TextStyle(fontSize: 12, color: textTertiary),
    ),
    dividerTheme: DividerThemeData(color: border, thickness: 1, space: 1),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: surface,
      contentTextStyle: TextStyle(color: textPrimary, fontSize: 14),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: borderStrong),
      ),
      behavior: SnackBarBehavior.floating,
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(
      color: accent,
      linearTrackColor: hover,
      circularTrackColor: hover,
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith(
        (states) =>
            states.contains(WidgetState.selected) ? (dark ? const Color(0xFF1F1F1F) : Colors.white) : textTertiary,
      ),
      trackColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.selected)
            ? accent
            : (dark ? const Color(0xFF3A3A3A) : const Color(0xFFCCCCCC)),
      ),
      trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: surface,
      surfaceTintColor: Colors.transparent,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
    ),
  );
}
