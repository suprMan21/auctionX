import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';
import '../../domain/entities/tag_detail.dart';
import '../providers/nfc_scan_provider.dart';
import '../widgets/verification_badge.dart';

final tagDetailFutureProvider =
    FutureProvider.family<TagDetail?, String>((ref, tagId) async {
  final repository = ref.watch(nfcRepositoryProvider);
  final result = await repository.getTagDetail(tagId);
  return result.fold((_) => null, (detail) => detail);
});

class TagDetailScreen extends ConsumerWidget {
  final String tagId;

  const TagDetailScreen({super.key, required this.tagId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detailAsync = ref.watch(tagDetailFutureProvider(tagId));

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: Text('Tag Details', style: AppTypography.titleLarge),
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
          if (detail == null) {
            return Center(
              child: Text('Tag not found',
                  style: AppTypography.bodyLarge
                      .copyWith(color: AppColors.textSecondary)),
            );
          }
          return _buildDetail(detail);
        },
      ),
    );
  }

  Widget _buildDetail(TagDetail detail) {
    final status = switch (detail.tag.status) {
      'active' => VerificationStatus.active,
      'verified' => VerificationStatus.verified,
      'registered' => VerificationStatus.registered,
      _ => VerificationStatus.invalid,
    };

    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Status badge
          Center(child: VerificationBadge(status: status)),
          const SizedBox(height: 24),

          // Tag info card
          _glassCard(
            title: 'Tag Information',
            children: [
              _infoRow('Tag UID', detail.tag.tagUid),
              _infoRow('Status', detail.tag.status),
              if (detail.tag.sunCounter != null)
                _infoRow('Scan Count', '${detail.tag.sunCounter}'),
              if (detail.tag.activatedAt != null)
                _infoRow('Activated', _formatDate(detail.tag.activatedAt!)),
            ],
          ),
          const SizedBox(height: 16),

          // Seller info
          if (detail.seller != null)
            _glassCard(
              title: 'Seller',
              children: [
                if (detail.seller!.username != null)
                  _infoRow('Username', detail.seller!.username!),
              ],
            ),
          if (detail.seller != null) const SizedBox(height: 16),

          // NFT certificate
          if (detail.nft != null) ...[
            _glassCard(
              title: 'NFT Certificate',
              children: [
                _infoRow('Chain', detail.nft!.chain),
                _infoRow('Contract', _truncateAddress(detail.nft!.contractAddress)),
                if (detail.nft!.tokenId != null)
                  _infoRow('Token ID', detail.nft!.tokenId!),
                if (detail.nft!.mintTxHash != null)
                  _infoRow('TX Hash', _truncateAddress(detail.nft!.mintTxHash!)),
              ],
            ),
            const SizedBox(height: 16),
          ],

          // Scan history
          if (detail.events.isNotEmpty)
            _glassCard(
              title: 'Scan History',
              children: [
                for (final event in detail.events.take(10))
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Row(
                      children: [
                        Icon(
                          event.cmacValid ? Icons.check_circle : Icons.cancel,
                          color: event.cmacValid
                              ? AppColors.success
                              : AppColors.error,
                          size: 18,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(event.scanType,
                                  style: AppTypography.bodySmall),
                              Text(
                                _formatDate(event.createdAt),
                                style: AppTypography.labelSmall.copyWith(
                                    color: AppColors.textTertiary),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
        ],
      ),
    );
  }

  Widget _glassCard({
    required String title,
    required List<Widget> children,
  }) {
    return Container(
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
          Text(title,
              style: AppTypography.titleMedium
                  .copyWith(color: AppColors.primary400)),
          const SizedBox(height: 12),
          ...children,
        ],
      ),
    );
  }

  Widget _infoRow(String label, String value) {
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

  String _truncateAddress(String address) {
    if (address.length <= 12) return address;
    return '${address.substring(0, 6)}...${address.substring(address.length - 4)}';
  }

  String _formatDate(String isoDate) {
    try {
      final dt = DateTime.parse(isoDate);
      return '${dt.year}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return isoDate;
    }
  }
}
