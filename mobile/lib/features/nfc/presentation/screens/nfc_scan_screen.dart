import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';
import '../../../../routing/route_names.dart';
import '../../../auth/presentation/providers/auth_provider.dart';
import '../../../auth/presentation/providers/auth_state.dart';
import '../../domain/entities/scan_result.dart';
import '../../domain/entities/tag_detail.dart';
import '../providers/nfc_scan_provider.dart';
import '../providers/nfc_scan_state.dart';
import '../widgets/scan_animation.dart';
import '../widgets/verification_badge.dart';

class NfcScanScreen extends ConsumerWidget {
  const NfcScanScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scanState = ref.watch(nfcScanNotifierProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: Text('NFC Verification', style: AppTypography.titleLarge),
        actions: [
          IconButton(
            icon: const Icon(Icons.history, color: AppColors.textSecondary),
            onPressed: () => context.push(RouteNames.scanHistory),
          ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: scanState.when(
            idle: () => _buildIdle(ref),
            checking: () => _buildLoading('Checking NFC availability...'),
            scanning: () => _buildScanning(ref),
            reading: () => _buildLoading('Reading tag data...'),
            validating: () => _buildLoading('Verifying authenticity...'),
            verified: (result, detail) =>
                _buildVerified(context, ref, result, detail),
            invalid: (result) => _buildInvalid(ref, result),
            savedOffline: () => _buildSavedOffline(ref),
            error: (message) => _buildError(ref, message),
            unavailable: () => _buildUnavailable(),
          ),
        ),
      ),
    );
  }

  Widget _buildIdle(WidgetRef ref) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 120,
            height: 120,
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              gradient: AppColors.primaryGradient,
            ),
            child: const Icon(Icons.nfc, color: Colors.white, size: 56),
          ),
          const SizedBox(height: 32),
          Text(
            'Tap your phone to an NFC tag',
            style: AppTypography.headlineSmall,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 12),
          Text(
            'Hold your device near an authenticated item to verify its authenticity',
            style: AppTypography.bodyMedium
                .copyWith(color: AppColors.textSecondary),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 48),
          _GradientButton(
            label: 'Start Scan',
            onPressed: () =>
                ref.read(nfcScanNotifierProvider.notifier).startScan(),
          ),
        ],
      ),
    );
  }

  Widget _buildScanning(WidgetRef ref) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const ScanAnimation(),
          const SizedBox(height: 40),
          Text(
            'Hold your phone near the tag...',
            style: AppTypography.titleLarge,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 12),
          Text(
            'Keep your device steady until the scan completes',
            style: AppTypography.bodyMedium
                .copyWith(color: AppColors.textSecondary),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 48),
          TextButton(
            onPressed: () =>
                ref.read(nfcScanNotifierProvider.notifier).cancelScan(),
            child: Text(
              'Cancel',
              style: AppTypography.labelLarge
                  .copyWith(color: AppColors.textSecondary),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLoading(String message) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const SizedBox(
            width: 48,
            height: 48,
            child: CircularProgressIndicator(
              color: AppColors.primary500,
              strokeWidth: 3,
            ),
          ),
          const SizedBox(height: 24),
          Text(message, style: AppTypography.titleMedium),
        ],
      ),
    );
  }

  Widget _buildVerified(
    BuildContext context,
    WidgetRef ref,
    ScanResult result,
    TagDetail? detail,
  ) {
    return Center(
      child: SingleChildScrollView(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 80,
              height: 80,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.success,
              ),
              child: const Icon(Icons.check, color: Colors.white, size: 44),
            ),
            const SizedBox(height: 24),
            Text('Authentic Item', style: AppTypography.headlineMedium),
            const SizedBox(height: 8),
            const VerificationBadge(status: VerificationStatus.verified),
            const SizedBox(height: 24),
            // Tag info card
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: AppColors.glassBg,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: AppColors.glassBorder),
              ),
              child: Column(
                children: [
                  _infoRow('Tag ID', result.tagId),
                  if (result.counterValue != null)
                    _infoRow('Scan Count', '${result.counterValue}'),
                  if (detail != null) ...[
                    _infoRow('Status', detail.tag.status),
                    if (detail.seller?.username != null)
                      _infoRow('Seller', detail.seller!.username!),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 24),
            if (detail != null)
              _GradientButton(
                label: 'View Details',
                onPressed: () =>
                    context.push('${RouteNames.tagDetail}/${result.tagId}'),
              ),
            if (detail != null) ...[
              const SizedBox(height: 12),
              Builder(
                builder: (ctx) {
                  final authState = ref.watch(authNotifierProvider);
                  final currentUserId = authState.maybeWhen(
                    authenticated: (user) => user.id,
                    orElse: () => null,
                  );
                  final isSeller = currentUserId != null &&
                      detail.tag.sellerId == currentUserId;
                  if (!isSeller) return const SizedBox.shrink();
                  return Padding(
                    padding: const EdgeInsets.only(top: 0),
                    child: SizedBox(
                      width: double.infinity,
                      height: 52,
                      child: OutlinedButton.icon(
                        onPressed: () => context.push(
                          RouteNames.videoRecord,
                          extra: {
                            'tagId': result.tagId,
                            'tagUid': detail.tag.tagUid,
                          },
                        ),
                        icon: const Icon(Icons.videocam,
                            color: AppColors.accent500),
                        label: Text(
                          'Add Video Proof',
                          style: AppTypography.labelLarge
                              .copyWith(color: AppColors.accent500),
                        ),
                        style: OutlinedButton.styleFrom(
                          side: const BorderSide(color: AppColors.accent500),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                      ),
                    ),
                  );
                },
              ),
            ],
            const SizedBox(height: 12),
            TextButton(
              onPressed: () =>
                  ref.read(nfcScanNotifierProvider.notifier).reset(),
              child: Text(
                'Scan Again',
                style: AppTypography.labelLarge
                    .copyWith(color: AppColors.accent500),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInvalid(WidgetRef ref, ScanResult result) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 80,
            height: 80,
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              color: AppColors.error,
            ),
            child: const Icon(Icons.close, color: Colors.white, size: 44),
          ),
          const SizedBox(height: 24),
          Text('Verification Failed', style: AppTypography.headlineMedium),
          const SizedBox(height: 8),
          const VerificationBadge(status: VerificationStatus.invalid),
          const SizedBox(height: 16),
          Text(
            'This tag could not be verified. It may be counterfeit or damaged.',
            style: AppTypography.bodyMedium
                .copyWith(color: AppColors.textSecondary),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 32),
          _GradientButton(
            label: 'Try Again',
            onPressed: () =>
                ref.read(nfcScanNotifierProvider.notifier).retry(),
          ),
        ],
      ),
    );
  }

  Widget _buildSavedOffline(WidgetRef ref) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 80,
            height: 80,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: AppColors.warning.withValues(alpha: 0.2),
            ),
            child: const Icon(Icons.cloud_off,
                color: AppColors.warning, size: 44),
          ),
          const SizedBox(height: 24),
          Text('Scan Saved', style: AppTypography.headlineMedium),
          const SizedBox(height: 12),
          Text(
            'No internet connection. Your scan has been saved and will be verified when you\'re back online.',
            style: AppTypography.bodyMedium
                .copyWith(color: AppColors.textSecondary),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 32),
          _GradientButton(
            label: 'Scan Another',
            onPressed: () =>
                ref.read(nfcScanNotifierProvider.notifier).reset(),
          ),
        ],
      ),
    );
  }

  Widget _buildError(WidgetRef ref, String message) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.error_outline, color: AppColors.error, size: 64),
          const SizedBox(height: 24),
          Text('Something went wrong', style: AppTypography.headlineSmall),
          const SizedBox(height: 12),
          Text(
            message,
            style: AppTypography.bodyMedium
                .copyWith(color: AppColors.textSecondary),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 32),
          _GradientButton(
            label: 'Try Again',
            onPressed: () =>
                ref.read(nfcScanNotifierProvider.notifier).retry(),
          ),
        ],
      ),
    );
  }

  Widget _buildUnavailable() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.nfc, color: AppColors.textTertiary, size: 64),
          const SizedBox(height: 24),
          Text('NFC Not Available', style: AppTypography.headlineSmall),
          const SizedBox(height: 12),
          Text(
            'Your device does not support NFC or it is disabled. Please enable NFC in your device settings.',
            style: AppTypography.bodyMedium
                .copyWith(color: AppColors.textSecondary),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _infoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
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
            ),
          ),
        ],
      ),
    );
  }
}

class _GradientButton extends StatelessWidget {
  final String label;
  final VoidCallback onPressed;

  const _GradientButton({required this.label, required this.onPressed});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: 52,
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: AppColors.primaryGradient,
          borderRadius: BorderRadius.circular(12),
        ),
        child: ElevatedButton(
          onPressed: onPressed,
          style: ElevatedButton.styleFrom(
            backgroundColor: Colors.transparent,
            shadowColor: Colors.transparent,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
          child: Text(label, style: AppTypography.labelLarge),
        ),
      ),
    );
  }
}
