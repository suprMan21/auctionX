import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';
import '../../../../routing/route_names.dart';
import '../providers/mint_provider.dart';
import '../providers/mint_state.dart';
import '../widgets/blockchain_progress.dart';

class MintingProgressScreen extends ConsumerStatefulWidget {
  final String tagId;

  const MintingProgressScreen({super.key, required this.tagId});

  @override
  ConsumerState<MintingProgressScreen> createState() =>
      _MintingProgressScreenState();
}

class _MintingProgressScreenState
    extends ConsumerState<MintingProgressScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(mintNotifierProvider.notifier).startMint(tagId: widget.tagId);
    });
  }

  @override
  Widget build(BuildContext context) {
    final mintState = ref.watch(mintNotifierProvider);

    // Navigate to success on completion
    ref.listen<MintState>(mintNotifierProvider, (prev, next) {
      next.when(
        idle: () {},
        preparingMetadata: () {},
        submittingTransaction: () {},
        waitingConfirmation: () {},
        success: (result) {
          context.pushReplacement(
              '${RouteNames.mintSuccess}/${widget.tagId}');
        },
        error: (_) {},
        timeout: () {},
      );
    });

    return PopScope(
      canPop: mintState.when(
        idle: () => true,
        preparingMetadata: () => false,
        submittingTransaction: () => false,
        waitingConfirmation: () => false,
        success: (_) => true,
        error: (_) => true,
        timeout: () => true,
      ),
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Spacer(),
                _buildContent(mintState),
                const Spacer(),
                _buildBottomAction(mintState),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildContent(MintState mintState) {
    return mintState.when(
      idle: () => const SizedBox.shrink(),
      preparingMetadata: () => _buildProgress(0),
      submittingTransaction: () => _buildProgress(1),
      waitingConfirmation: () => _buildProgress(2),
      success: (_) => _buildProgress(3),
      error: (message) => _buildError(message),
      timeout: () => _buildTimeout(),
    );
  }

  Widget _buildProgress(int currentStep) {
    return Column(
      children: [
        SizedBox(
          width: 80,
          height: 80,
          child: currentStep < 3
              ? const CircularProgressIndicator(
                  strokeWidth: 3,
                  color: AppColors.primary500,
                )
              : const Icon(Icons.check_circle,
                  color: AppColors.success, size: 80),
        ),
        const SizedBox(height: 32),
        Text(
          currentStep < 3
              ? 'Creating Verification...'
              : 'Verification Created!',
          style: AppTypography.headlineSmall,
        ),
        if (currentStep == 2)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              'This may take a moment...',
              style: AppTypography.bodyMedium
                  .copyWith(color: AppColors.textSecondary),
            ),
          ),
        const SizedBox(height: 40),
        BlockchainProgress(currentStep: currentStep),
      ],
    );
  }

  Widget _buildError(String message) {
    return Column(
      children: [
        const Icon(Icons.error_outline, color: AppColors.error, size: 64),
        const SizedBox(height: 24),
        Text('Verification Failed', style: AppTypography.headlineSmall),
        const SizedBox(height: 12),
        Text(
          message,
          style:
              AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 32),
        SizedBox(
          width: double.infinity,
          height: 52,
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: AppColors.primaryGradient,
              borderRadius: BorderRadius.circular(12),
            ),
            child: ElevatedButton(
              onPressed: () {
                ref
                    .read(mintNotifierProvider.notifier)
                    .retry(tagId: widget.tagId);
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.transparent,
                shadowColor: Colors.transparent,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              child: Text('Try Again', style: AppTypography.labelLarge),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildTimeout() {
    return Column(
      children: [
        const Icon(Icons.timer_outlined,
            color: AppColors.warning, size: 64),
        const SizedBox(height: 24),
        Text('Taking Longer Than Usual',
            style: AppTypography.headlineSmall),
        const SizedBox(height: 12),
        Text(
          'The verification is still being processed. You can check back later from the tag details page.',
          style:
              AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }

  Widget _buildBottomAction(MintState mintState) {
    return mintState.when(
      idle: () => const SizedBox.shrink(),
      preparingMetadata: () => const SizedBox.shrink(),
      submittingTransaction: () => const SizedBox.shrink(),
      waitingConfirmation: () => const SizedBox.shrink(),
      success: (_) => const SizedBox.shrink(),
      error: (_) => TextButton(
        onPressed: () => Navigator.of(context).pop(),
        child: Text('Go Back',
            style:
                AppTypography.bodyMedium.copyWith(color: AppColors.textTertiary)),
      ),
      timeout: () => Column(
        children: [
          SizedBox(
            width: double.infinity,
            height: 52,
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: AppColors.primaryGradient,
                borderRadius: BorderRadius.circular(12),
              ),
              child: ElevatedButton(
                onPressed: () {
                  ref
                      .read(mintNotifierProvider.notifier)
                      .retry(tagId: widget.tagId);
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.transparent,
                  shadowColor: Colors.transparent,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                child:
                    Text('Check Again', style: AppTypography.labelLarge),
              ),
            ),
          ),
          const SizedBox(height: 12),
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: Text('Check Back Later',
                style: AppTypography.bodyMedium
                    .copyWith(color: AppColors.textTertiary)),
          ),
        ],
      ),
    );
  }
}
