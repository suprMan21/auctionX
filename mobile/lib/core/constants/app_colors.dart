import 'package:flutter/painting.dart';

class AppColors {
  AppColors._();

  // Backgrounds
  static const background = Color(0xFF13131A);
  static const surface = Color(0xFF1A1A24);
  static const surfaceLight = Color(0xFF252533);
  static const surfaceLighter = Color(0xFF2D2D3D);
  static const darkest = Color(0xFF0A0A0F);

  // Primary (purple)
  static const primary400 = Color(0xFF9333EA);
  static const primary500 = Color(0xFF7C3AED);
  static const primary600 = Color(0xFF6D28D9);
  static const primary700 = Color(0xFF5B21B6);

  // Indigo (gradient middle)
  static const indigo500 = Color(0xFF6366F1);

  // Accent (blue)
  static const accent400 = Color(0xFF60A5FA);
  static const accent500 = Color(0xFF3B82F6);
  static const accent600 = Color(0xFF2563EB);

  // Semantic
  static const success = Color(0xFF10B981);
  static const error = Color(0xFFEF4444);
  static const warning = Color(0xFFF59E0B);

  // Glass
  static const glassBg = Color(0x0AFFFFFF); // ~4% white
  static const glassBorder = Color(0x14FFFFFF); // ~8% white
  static const glassBorderHover = Color(0x24FFFFFF); // ~14% white

  // Text
  static const textPrimary = Color(0xFFFFFFFF);
  static const textSecondary = Color(0xB3FFFFFF); // 70% white
  static const textTertiary = Color(0x80FFFFFF); // 50% white

  // Gradient
  static const gradientStart = primary500;
  static const gradientMiddle = indigo500;
  static const gradientEnd = accent500;

  static const primaryGradient = LinearGradient(
    colors: [gradientStart, gradientMiddle, gradientEnd],
  );
}
