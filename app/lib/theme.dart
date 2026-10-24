import 'package:flutter/material.dart';

/// Deliberately warm, not alarming — see MVP-PRD.md §2/§5. A debt tracker
/// that visually screams "DANGER" every time you open it works against the
/// whole thesis (protect the friendship, don't add shame). No red used for
/// "overdue" — amber instead, and even then only as a small accent.
class FunguColors {
  static const warmBlue = Color(0xFF2E5C8A);
  static const softAmber = Color(0xFFD9A441);
  static const background = Color(0xFFFBF8F3);
  static const surface = Color(0xFFFFFFFF);
  static const textPrimary = Color(0xFF2A2622);
  static const textSecondary = Color(0xFF6B6459);
  static const success = Color(0xFF3E7A55);
}

ThemeData funguTheme() {
  return ThemeData(
    useMaterial3: true,
    scaffoldBackgroundColor: FunguColors.background,
    colorScheme: ColorScheme.fromSeed(
      seedColor: FunguColors.warmBlue,
      primary: FunguColors.warmBlue,
      secondary: FunguColors.softAmber,
      surface: FunguColors.surface,
    ),
    textTheme: const TextTheme(
      bodyMedium: TextStyle(color: FunguColors.textPrimary),
      bodySmall: TextStyle(color: FunguColors.textSecondary),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: FunguColors.background,
      foregroundColor: FunguColors.textPrimary,
      elevation: 0,
      centerTitle: false,
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: FunguColors.warmBlue,
        foregroundColor: Colors.white,
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 24),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: FunguColors.surface,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide.none,
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
    ),
  );
}
