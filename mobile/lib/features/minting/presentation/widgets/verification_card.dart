import 'package:flutter/material.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';

class VerificationCard extends StatelessWidget {
  final String verificationNumber;
  final String itemName;
  final String tagUid;
  final int verifiedCount;
  final GlobalKey? repaintKey;

  const VerificationCard({
    super.key,
    required this.verificationNumber,
    required this.itemName,
    required this.tagUid,
    required this.verifiedCount,
    this.repaintKey,
  });

  @override
  Widget build(BuildContext context) {
    final card = Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFF1E1B4B),
            Color(0xFF312E81),
            Color(0xFF1E1B4B),
          ],
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: AppColors.primary500.withValues(alpha: 0.4),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primary500.withValues(alpha: 0.2),
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'AUTHENTIC',
                style: AppTypography.labelSmall.copyWith(
                  color: AppColors.primary400,
                  letterSpacing: 2,
                ),
              ),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.success.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.verified,
                        color: AppColors.success, size: 14),
                    const SizedBox(width: 4),
                    Text('VERIFIED',
                        style: AppTypography.labelSmall
                            .copyWith(color: AppColors.success)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),

          // Verification number
          Text(
            'Verification $verificationNumber',
            style: AppTypography.headlineMedium.copyWith(
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 8),

          // Item name
          Text(
            itemName,
            style: AppTypography.bodyLarge
                .copyWith(color: AppColors.textSecondary),
          ),
          const SizedBox(height: 20),

          // Footer
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Tag',
                      style: AppTypography.labelSmall
                          .copyWith(color: AppColors.textTertiary)),
                  Text(
                    tagUid.length > 10
                        ? '${tagUid.substring(0, 6)}...${tagUid.substring(tagUid.length - 4)}'
                        : tagUid,
                    style: AppTypography.bodySmall,
                  ),
                ],
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text('Verifications',
                      style: AppTypography.labelSmall
                          .copyWith(color: AppColors.textTertiary)),
                  Text('$verifiedCount', style: AppTypography.bodySmall),
                ],
              ),
            ],
          ),
          const SizedBox(height: 16),

          // URL bar
          Container(
            width: double.infinity,
            padding:
                const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.3),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              'authentic-materials.com/verify',
              style: AppTypography.bodySmall
                  .copyWith(color: AppColors.textTertiary),
              textAlign: TextAlign.center,
            ),
          ),
        ],
      ),
    );

    if (repaintKey != null) {
      return RepaintBoundary(key: repaintKey, child: card);
    }
    return card;
  }
}
