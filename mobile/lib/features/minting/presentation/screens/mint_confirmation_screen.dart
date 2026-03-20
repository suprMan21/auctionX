import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';
import '../../../../routing/route_names.dart';
import '../../../nfc/presentation/screens/tag_detail_screen.dart';

class MintConfirmationScreen extends ConsumerWidget {
  final String tagId;

  const MintConfirmationScreen({super.key, required this.tagId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detailAsync = ref.watch(tagDetailFutureProvider(tagId));

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: AppColors.textPrimary),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: detailAsync.when(
        loading: () => const Center(
          child: CircularProgressIndicator(color: AppColors.primary500),
        ),
        error: (e, _) => Center(
          child: Text('Error: $e',
              style:
                  AppTypography.bodyMedium.copyWith(color: AppColors.error)),
        ),
        data: (detail) {
          final itemName = detail?.seller?.username != null
              ? '${detail!.seller!.username}\'s item'
              : 'Authenticated Item';
          final tagUid = detail?.tag.tagUid ?? '';
          final sellerName = detail?.seller?.username ?? 'Unknown';

          return SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Header
                  Text(
                    'Create Permanent Verification',
                    style: AppTypography.headlineMedium,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'This creates an immutable record proving this item\'s authenticity.',
                    style: AppTypography.bodyMedium
                        .copyWith(color: AppColors.textSecondary),
                  ),
                  const SizedBox(height: 32),

                  // Summary card
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      color: AppColors.glassBg,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: AppColors.glassBorder),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Item Summary',
                            style: AppTypography.titleMedium
                                .copyWith(color: AppColors.primary400)),
                        const SizedBox(height: 16),
                        _summaryRow('Item', itemName),
                        _summaryRow('Tag UID', tagUid),
                        _summaryRow('Seller', sellerName),
                      ],
                    ),
                  ),
                  const SizedBox(height: 24),

                  // Checklist
                  _checkItem('Tag Verified', true),
                  const SizedBox(height: 12),
                  _checkItem('Video Proof Uploaded', true),
                  const SizedBox(height: 12),
                  _checkItem('Permanent Verification', false, isPending: true),

                  const Spacer(),

                  // Free badge
                  Center(
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 8),
                      decoration: BoxDecoration(
                        color: AppColors.success.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                            color: AppColors.success.withValues(alpha: 0.3)),
                      ),
                      child: Text(
                        'Free — no cost to you',
                        style: AppTypography.labelLarge
                            .copyWith(color: AppColors.success),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),

                  // CTA button
                  SizedBox(
                    width: double.infinity,
                    height: 56,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: AppColors.primaryGradient,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: ElevatedButton(
                        onPressed: () {
                          context.push('${RouteNames.minting}/$tagId');
                        },
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.transparent,
                          shadowColor: Colors.transparent,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                        child: Text(
                          'Create Permanent Verification',
                          style: AppTypography.labelLarge,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),

                  // Skip
                  Center(
                    child: TextButton(
                      onPressed: () => Navigator.of(context).pop(),
                      child: Text(
                        'Skip for now',
                        style: AppTypography.bodyMedium
                            .copyWith(color: AppColors.textTertiary),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _summaryRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label,
              style: AppTypography.bodySmall
                  .copyWith(color: AppColors.textTertiary)),
          Flexible(
            child: Text(
              value,
              style: AppTypography.bodySmall
                  .copyWith(color: AppColors.textPrimary),
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.end,
            ),
          ),
        ],
      ),
    );
  }

  Widget _checkItem(String label, bool done, {bool isPending = false}) {
    return Row(
      children: [
        Icon(
          done ? Icons.check_circle : Icons.radio_button_unchecked,
          color: done
              ? AppColors.success
              : isPending
                  ? AppColors.primary400
                  : AppColors.textTertiary,
          size: 22,
        ),
        const SizedBox(width: 12),
        Text(
          label,
          style: AppTypography.bodyLarge.copyWith(
            color: done ? AppColors.textPrimary : AppColors.textSecondary,
          ),
        ),
      ],
    );
  }
}
