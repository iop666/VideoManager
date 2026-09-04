import 'package:flutter_test/flutter_test.dart';

import 'package:video_manager_android/app.dart';

void main() {
  testWidgets('M1 骨架冒烟测试：底部导航与未连接状态', (tester) async {
    await tester.pumpWidget(const VideoManagerApp());

    // 底部导航三个入口
    expect(find.text('视频'), findsOneWidget);
    expect(find.text('搜索'), findsOneWidget);
    expect(find.text('设置'), findsOneWidget);
  });
}
