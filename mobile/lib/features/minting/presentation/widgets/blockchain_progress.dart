import 'package:flutter/material.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';

class BlockchainProgress extends StatelessWidget {
  final int currentStep;

  const BlockchainProgress({super.key, required this.currentStep});

  static const _steps = [
    'Metadata uploaded',
    'Transaction submitted',
    'Waiting for confirmation',
    'Verification created',
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.glassBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.glassBorder),
      ),
      child: Column(
        children: List.generate(_steps.length, (i) {
          final isDone = i < currentStep;
          final isCurrent = i == currentStep;

          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Row(
              children: [
                SizedBox(
                  width: 24,
                  height: 24,
                  child: isDone
                      ? const Icon(Icons.check_circle,
                          color: AppColors.success, size: 22)
                      : isCurrent
                          ? const SizedBox(
                              width: 22,
                              height: 22,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: AppColors.primary400,
                              ),
                            )
                          : Icon(Icons.radio_button_unchecked,
                              color: AppColors.textTertiary
                                  .withValues(alpha: 0.5),
                              size: 22),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Text(
                    _steps[i],
                    style: AppTypography.bodyMedium.copyWith(
                      color: isDone || isCurrent
                          ? AppColors.textPrimary
                          : AppColors.textTertiary,
                    ),
                  ),
                ),
                if (isDone)
                  const Icon(Icons.check, color: AppColors.success, size: 16),
              ],
            ),
          );
        }),
      ),
    );
  }
}
