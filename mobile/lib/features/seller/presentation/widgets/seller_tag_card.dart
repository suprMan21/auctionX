import 'package:flutter/material.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';
import '../../domain/entities/seller_tag.dart';

class SellerTagCard extends StatelessWidget {
  final SellerTag tag;
  final VoidCallback onTap;

  const SellerTagCard({super.key, required this.tag, required this.onTap});

  Color _statusColor(String status) {
    return switch (status.toLowerCase()) {
      'active' => AppColors.success,
      'pending' => AppColors.warning,
      'sold' => AppColors.accent500,
      _ => AppColors.textTertiary,
    };
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.glassBg,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.glassBorder),
        ),
        child: Row(
          children: [
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                color: AppColors.surfaceLight,
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Icon(Icons.nfc, color: AppColors.primary500),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    tag.listingTitle ?? 'Unlinked Tag',
                    style: AppTypography.titleMedium,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Text(
                        tag.tagUid.length > 10
                            ? '${tag.tagUid.substring(0, 10)}...'
                            : tag.tagUid,
                        style: AppTypography.bodySmall.copyWith(
                            color: AppColors.textTertiary,
                            fontFamily: 'monospace'),
                      ),
                      const SizedBox(width: 8),
                      if (tag.scanCount > 0) ...[
                        Icon(Icons.remove_red_eye_outlined,
                            size: 12, color: AppColors.textTertiary),
                        const SizedBox(width: 2),
                        Text('${tag.scanCount}',
                            style: AppTypography.bodySmall
                                .copyWith(color: AppColors.textTertiary)),
                      ],
                      if (tag.nftTokenId != null) ...[
                        const SizedBox(width: 8),
                        ShaderMask(
                          shaderCallback: (bounds) =>
                              AppColors.primaryGradient.createShader(bounds),
                          child: const Icon(Icons.token,
                              color: Colors.white, size: 14),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: _statusColor(tag.status).withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                tag.status.toUpperCase(),
                style: AppTypography.labelSmall.copyWith(
                  color: _statusColor(tag.status),
                ),
              ),
            ),
            const SizedBox(width: 8),
            const Icon(Icons.chevron_right, color: AppColors.textTertiary),
          ],
        ),
      ),
    );
  }
}
