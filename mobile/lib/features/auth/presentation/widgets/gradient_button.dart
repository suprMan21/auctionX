import 'package:flutter/material.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';

class GradientButton extends StatelessWidget {
  final String text;
  final VoidCallback? onPressed;
  final bool isLoading;

  const GradientButton({
    super.key,
    required this.text,
    this.onPressed,
    this.isLoading = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      height: 52,
      decoration: BoxDecoration(
        gradient: onPressed != null ? AppColors.primaryGradient : null,
        color: onPressed == null ? AppColors.surfaceLight : null,
        borderRadius: BorderRadius.circular(12),
        boxShadow: onPressed != null
            ? [
                BoxShadow(
                  color: AppColors.primary500.withValues(alpha: 0.25),
                  blurRadius: 24,
                  offset: const Offset(0, 4),
                ),
              ]
            : null,
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: isLoading ? null : onPressed,
          borderRadius: BorderRadius.circular(12),
          child: Center(
            child: isLoading
                ? const SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(
                      color: Colors.white,
                      strokeWidth: 2.5,
                    ),
                  )
                : Text(
                    text,
                    style: AppTypography.labelLarge.copyWith(
                      color: Colors.white,
                    ),
                  ),
          ),
        ),
      ),
    );
  }
}
