import 'package:flutter/material.dart';

/// Shared between main.dart and api_client.dart so ApiClient can redirect
/// to login on a 401 from anywhere, without importing a screen widget
/// directly — screens already import api_client.dart, so the reverse
/// import would be circular. main.dart sets both of these once at startup.
final rootNavigatorKey = GlobalKey<NavigatorState>();
Widget Function()? loginScreenBuilder;
