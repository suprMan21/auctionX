import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';
import '../../../nfc/presentation/screens/tag_detail_screen.dart';
import '../providers/mint_provider.dart';
import '../providers/mint_state.dart';
import '../../domain/entities/mint_result.dart';
import '../widgets/verification_card.dart';
import '../widgets/share_sheet.dart';

class MintSuccessScreen extends ConsumerWidget {
  final String tagId;

  const MintSuccessScreen({super.key, required this.tagId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mintState = ref.watch(mintNotifierProvider);
    final detailAsync = ref.watch(tagDetailFutureProvider(tagId));

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              const SizedBox(height: 40),

              // Celebration header
              const Icon(Icons.verified, color: AppColors.success, size: 72),
              const SizedBox(height: 16),
              Text('Verified!', style: AppTypography.headlineLarge),
              const SizedBox(height: 8),
              Text(
                'This item now has a permanent verification record.',
                style: AppTypography.bodyMedium
                    .copyWith(color: AppColors.textSecondary),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 32),

              // Verification card
              detailAsync.when(
                loading: () => const SizedBox.shrink(),
                error: (e, st) => const SizedBox.shrink(),
                data: (detail) {
                  final tokenId = mintState.when(
                    success: (r) => r.tokenId,
                    idle: () => '',
                    preparingMetadata: () => '',
                    submittingTransaction: () => '',
                    waitingConfirmation: () => '',
                    error: (_) => '',
                    timeout: () => '',
                  );
                  return VerificationCard(
                    verificationNumber: tokenId.isNotEmpty
                        ? '#${tokenId.padLeft(5, '0')}'
                        : '#00000',
                    itemName: detail?.seller?.username != null
                        ? '${detail!.seller!.username}\'s item'
                        : 'Authenticated Item',
                    tagUid: detail?.tag.tagUid ?? '',
                    verifiedCount: detail?.events.length ?? 0,
                  );
                },
              ),
              const SizedBox(height: 24),

              // Technical details (collapsible)
              mintState.when(
                success: (result) => _buildTechnicalDetails(result),
                idle: () => const SizedBox.shrink(),
                preparingMetadata: () => const SizedBox.shrink(),
                submittingTransaction: () => const SizedBox.shrink(),
                waitingConfirmation: () => const SizedBox.shrink(),
                error: (_) => const SizedBox.shrink(),
                timeout: () => const SizedBox.shrink(),
              ),
              const SizedBox(height: 32),

              // Share button
              SizedBox(
                width: double.infinity,
                height: 52,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: AppColors.primaryGradient,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: ElevatedButton.icon(
                    onPressed: () {
                      showModalBottomSheet<void>(
                        context: context,
                        backgroundColor: Colors.transparent,
                        builder: (_) => ShareSheet(tagId: tagId),
                      );
                    },
                    icon: const Icon(Icons.share, color: Colors.white),
                    label: Text('Share', style: AppTypography.labelLarge),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.transparent,
                      shadowColor: Colors.transparent,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 12),

              // Copy link
              SizedBox(
                width: double.infinity,
                height: 52,
                child: OutlinedButton.icon(
                  onPressed: () {
                    final url =
                        'https://authentic-materials.com/verify/$tagId';
                    Clipboard.setData(ClipboardData(text: url));
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Link copied to clipboard'),
                        duration: Duration(seconds: 2),
                      ),
                    );
                  },
                  icon: const Icon(Icons.copy, color: AppColors.textPrimary),
                  label: Text('Copy Link',
                      style: AppTypography.labelLarge
                          .copyWith(color: AppColors.textPrimary)),
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: AppColors.glassBorder),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 12),

              // Done
              TextButton(
                onPressed: () {
                  Navigator.of(context)
                      .popUntil((route) => route.isFirst);
                },
                child: Text('Done',
                    style: AppTypography.bodyMedium
                        .copyWith(color: AppColors.textTertiary)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildTechnicalDetails(MintResult result) {
    return ExpansionTile(
      title: Text('Technical Details',
          style:
              AppTypography.labelLarge.copyWith(color: AppColors.textSecondary)),
      iconColor: AppColors.textTertiary,
      collapsedIconColor: AppColors.textTertiary,
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.glassBg,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.glassBorder),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _techRow('Token ID', result.tokenId),
              _techRow('Transaction', _truncate(result.txHash)),
              _techRow('Chain', result.chain),
              _techRow('Contract', _truncate(result.contractAddress)),
              const SizedBox(height: 8),
              GestureDetector(
                onTap: () {
                  Clipboard.setData(
                      ClipboardData(text: result.blockExplorerUrl));
                },
                child: Text(
                  'View proof record',
                  style: AppTypography.bodySmall
                      .copyWith(color: AppColors.accent400),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _techRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label,
              style: AppTypography.bodySmall
                  .copyWith(color: AppColors.textTertiary)),
          Flexible(
            child: Text(value,
                style: AppTypography.bodySmall
                    .copyWith(color: AppColors.textPrimary),
                overflow: TextOverflow.ellipsis),
          ),
        ],
      ),
    );
  }

  String _truncate(String s) {
    if (s.length <= 12) return s;
    return '${s.substring(0, 6)}...${s.substring(s.length - 4)}';
  }
}
