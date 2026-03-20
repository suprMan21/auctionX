import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';
import '../../../auth/presentation/widgets/gradient_button.dart';
import '../widgets/qr_branded_card.dart';

class QrGenerateScreen extends ConsumerWidget {
  final String tagId;

  const QrGenerateScreen({super.key, required this.tagId});

  String get _verifyUrl =>
      'https://authentic-materials.com/verify?tag=$tagId';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('QR Code')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            QrBrandedCard(
              child: QrImageView(
                data: _verifyUrl,
                version: QrVersions.auto,
                size: 200,
                eyeStyle: const QrEyeStyle(
                  eyeShape: QrEyeShape.circle,
                  color: AppColors.textPrimary,
                ),
                dataModuleStyle: const QrDataModuleStyle(
                  dataModuleShape: QrDataModuleShape.circle,
                  color: AppColors.textPrimary,
                ),
                backgroundColor: Colors.transparent,
              ),
            ),
            const SizedBox(height: 24),
            Text('Verification QR Code', style: AppTypography.titleLarge),
            const SizedBox(height: 8),
            Text(
              'Attach this to your item or listing photo',
              style: AppTypography.bodyMedium
                  .copyWith(color: AppColors.textSecondary),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: AppColors.surfaceLight,
                borderRadius: BorderRadius.circular(8),
              ),
              child: SelectableText(
                _verifyUrl,
                style: AppTypography.bodySmall
                    .copyWith(color: AppColors.accent400, fontFamily: 'monospace'),
              ),
            ),
            const SizedBox(height: 32),
            GradientButton(
              text: 'Share QR Code',
              onPressed: () {
                SharePlus.instance.share(
                  ShareParams(
                    text:
                        'Verify authenticity: $_verifyUrl',
                  ),
                );
              },
            ),
            const SizedBox(height: 12),
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: Text('Done',
                  style: AppTypography.bodyMedium
                      .copyWith(color: AppColors.textSecondary)),
            ),
          ],
        ),
      ),
    );
  }
}
