import 'package:flutter/material.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';

class RegistrationStepIndicator extends StatelessWidget {
  final int currentStep;
  final List<String> steps;

  const RegistrationStepIndicator({
    super.key,
    required this.currentStep,
    required this.steps,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: List.generate(steps.length * 2 - 1, (index) {
        if (index.isOdd) {
          // Connector line
          final stepBefore = index ~/ 2;
          return Expanded(
            child: Container(
              height: 2,
              color: stepBefore < currentStep
                  ? AppColors.primary500
                  : AppColors.surfaceLight,
            ),
          );
        }
        final stepIndex = index ~/ 2;
        final isCompleted = stepIndex < currentStep;
        final isCurrent = stepIndex == currentStep;

        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: isCompleted
                    ? AppColors.primary500
                    : isCurrent
                        ? AppColors.primary500.withValues(alpha: 0.2)
                        : AppColors.surfaceLight,
                border: isCurrent
                    ? Border.all(color: AppColors.primary500, width: 2)
                    : null,
              ),
              child: Center(
                child: isCompleted
                    ? const Icon(Icons.check, color: Colors.white, size: 16)
                    : Text(
                        '${stepIndex + 1}',
                        style: AppTypography.labelSmall.copyWith(
                          color: isCurrent
                              ? AppColors.primary500
                              : AppColors.textTertiary,
                        ),
                      ),
              ),
            ),
            const SizedBox(height: 4),
            Text(
              steps[stepIndex],
              style: AppTypography.labelSmall.copyWith(
                color: isCurrent || isCompleted
                    ? AppColors.textPrimary
                    : AppColors.textTertiary,
                fontSize: 9,
              ),
            ),
          ],
        );
      }),
    );
  }
}
