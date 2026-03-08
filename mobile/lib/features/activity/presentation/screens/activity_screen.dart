import 'package:flutter/material.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';

class ActivityScreen extends StatelessWidget {
  const ActivityScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Activity')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.notifications_none,
                size: 64, color: AppColors.textTertiary),
            const SizedBox(height: 16),
            Text(
              'No activity yet',
              style: AppTypography.titleMedium
                  .copyWith(color: AppColors.textSecondary),
            ),
            const SizedBox(height: 8),
            Text(
              'Your activity will appear here',
              style: AppTypography.bodySmall
                  .copyWith(color: AppColors.textTertiary),
            ),
          ],
        ),
      ),
    );
  }
}
