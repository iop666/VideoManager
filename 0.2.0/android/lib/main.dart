import 'package:flutter/material.dart';

import 'app.dart';
import 'core/theme_controller.dart';
import 'services/connection_manager.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await ThemeController.instance.init();
  await ConnectionManager.instance.init();
  runApp(const VideoManagerApp());
}
