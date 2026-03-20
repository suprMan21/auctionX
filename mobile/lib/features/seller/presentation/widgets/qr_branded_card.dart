import 'package:flutter/material.dart';
import 'dart:ui';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';

class QrBrandedCard extends StatelessWidget {
  final Widget child;

  const QrBrandedCard({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(24),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
        child: Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: AppColors.glassBg,
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: AppColors.glassBorder),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ShaderMask(
                shaderCallback: (bounds) =>
                    AppColors.primaryGradient.createShader(bounds),
                child: Text(
                  'AUTHENTIC MATERIALS',
                  style: AppTypography.labelSmall.copyWith(
                    color: Colors.white,
                    letterSpacing: 2,
                  ),
                ),
              ),
              const SizedBox(height: 16),
              child,
              const SizedBox(height: 12),
              Text(
                'Scan to verify authenticity',
                style: AppTypography.bodySmall
                    .copyWith(color: AppColors.textTertiary),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
