import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';
import '../../../../routing/route_names.dart';
import '../providers/video_proof_provider.dart';
import '../providers/video_proof_state.dart';

class UploadProgressScreen extends ConsumerStatefulWidget {
  final String tagId;
  final String tagUid;
  final String filePath;
  final int durationSeconds;

  const UploadProgressScreen({
    super.key,
    required this.tagId,
    required this.tagUid,
    required this.filePath,
    required this.durationSeconds,
  });

  @override
  ConsumerState<UploadProgressScreen> createState() =>
      _UploadProgressScreenState();
}

class _UploadProgressScreenState extends ConsumerState<UploadProgressScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _startProcess();
    });
  }

  void _startProcess() {
    ref
        .read(videoProofNotifierProvider.notifier)
        .burnOverlay(widget.filePath, widget.tagUid);
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(videoProofNotifierProvider);

    // Auto-upload after compression
    ref.listen<VideoProofState>(videoProofNotifierProvider, (prev, next) {
      if (next is VideoProofCompressed) {
        ref.read(videoProofNotifierProvider.notifier).uploadVideo(
              tagId: widget.tagId,
              filePath: next.filePath,
              fileSize: next.fileSize,
            );
      }
    });

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: Text('Upload', style: AppTypography.titleLarge),
        automaticallyImplyLeading: false,
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: state.when(
            idle: () => _buildCompressing(0),
            initializing: () => _buildCompressing(0),
            ready: (_) => _buildCompressing(0),
            recording: (_, __) => _buildCompressing(0),
            stopped: (_, __) => _buildBurning(0),
            burning: (progress) => _buildBurning(progress),
            compressing: (progress) => _buildCompressing(progress),
            compressed: (_, __, ___) => _buildCompressing(1.0),
            uploading: (progress) => _buildUploading(progress),
            complete: (publicUrl) => _buildComplete(publicUrl),
            error: (message) => _buildError(message),
            permissionDenied: () => _buildError('Permission denied'),
          ),
        ),
      ),
    );
  }

  Widget _buildBurning(double progress) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SizedBox(
            width: 100,
            height: 100,
            child: CircularProgressIndicator(
              value: progress > 0 ? progress : null,
              strokeWidth: 4,
              color: AppColors.primary500,
              backgroundColor: AppColors.glassBorder,
            ),
          ),
          const SizedBox(height: 24),
          Text('Adding verification overlay...', style: AppTypography.titleMedium),
          const SizedBox(height: 8),
          Text(
            '${(progress * 100).toInt()}%',
            style: AppTypography.bodyMedium
                .copyWith(color: AppColors.textSecondary),
          ),
        ],
      ),
    );
  }

  Widget _buildCompressing(double progress) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SizedBox(
            width: 100,
            height: 100,
            child: CircularProgressIndicator(
              value: progress > 0 ? progress : null,
              strokeWidth: 4,
              color: AppColors.primary500,
              backgroundColor: AppColors.glassBorder,
            ),
          ),
          const SizedBox(height: 24),
          Text('Compressing video...', style: AppTypography.titleMedium),
          const SizedBox(height: 8),
          Text(
            '${(progress * 100).toInt()}%',
            style: AppTypography.bodyMedium
                .copyWith(color: AppColors.textSecondary),
          ),
        ],
      ),
    );
  }

  Widget _buildUploading(UploadProgress progress) {
    final fraction = progress.fraction;
    final sentMB = (progress.bytesSent / (1024 * 1024)).toStringAsFixed(1);
    final totalMB = progress.totalBytes > 0
        ? (progress.totalBytes / (1024 * 1024)).toStringAsFixed(1)
        : '?';

    // Use indeterminate for tiny files or when total is unknown
    final useIndeterminate = progress.totalBytes < 5 * 1024 * 1024;

    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.cloud_upload_outlined,
              color: AppColors.primary500, size: 64),
          const SizedBox(height: 24),
          Text('Uploading...', style: AppTypography.titleMedium),
          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            child: LinearProgressIndicator(
              value: useIndeterminate ? null : fraction,
              minHeight: 6,
              color: AppColors.primary500,
              backgroundColor: AppColors.glassBorder,
              borderRadius: BorderRadius.circular(3),
            ),
          ),
          const SizedBox(height: 12),
          Text(
            useIndeterminate
                ? '$sentMB MB uploaded'
                : '$sentMB / $totalMB MB  •  ${(fraction * 100).toInt()}%',
            style: AppTypography.bodySmall
                .copyWith(color: AppColors.textSecondary),
          ),
        ],
      ),
    );
  }

  Widget _buildComplete(String publicUrl) {
    return Center(
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
          Text('Upload Complete', style: AppTypography.headlineMedium),
          const SizedBox(height: 8),
          Text(
            'Video proof has been uploaded successfully.',
            style: AppTypography.bodyMedium
                .copyWith(color: AppColors.textSecondary),
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
                  // Pop back to the NFC scan screen
                  context.go(RouteNames.nfc);
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.transparent,
                  shadowColor: Colors.transparent,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                child: Text('Done', style: AppTypography.labelLarge),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildError(String message) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.error_outline, color: AppColors.error, size: 64),
          const SizedBox(height: 16),
          Text('Upload Failed', style: AppTypography.headlineSmall),
          const SizedBox(height: 12),
          Text(
            message,
            style: AppTypography.bodyMedium
                .copyWith(color: AppColors.textSecondary),
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
                onPressed: _startProcess,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.transparent,
                  shadowColor: Colors.transparent,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                child: Text('Retry', style: AppTypography.labelLarge),
              ),
            ),
          ),
          const SizedBox(height: 12),
          TextButton(
            onPressed: () => context.go(RouteNames.nfc),
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
}
