import 'package:flutter/material.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';

class NfcPlaceholderScreen extends StatelessWidget {
  const NfcPlaceholderScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scan')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 100,
              height: 100,
              decoration: BoxDecoration(
                gradient: AppColors.primaryGradient,
                borderRadius: BorderRadius.circular(24),
              ),
              child: const Icon(Icons.nfc, color: Colors.white, size: 48),
            ),
            const SizedBox(height: 24),
            Text(
              'NFC Verification',
              style: AppTypography.headlineSmall,
            ),
            const SizedBox(height: 8),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 48),
              child: Text(
                'Scan NFC tags to verify authenticity of items',
                textAlign: TextAlign.center,
                style: AppTypography.bodyMedium
                    .copyWith(color: AppColors.textSecondary),
              ),
            ),
            const SizedBox(height: 32),
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
              decoration: BoxDecoration(
                color: AppColors.accent500.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                'Coming in next update',
                style: AppTypography.labelLarge
                    .copyWith(color: AppColors.accent500),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
