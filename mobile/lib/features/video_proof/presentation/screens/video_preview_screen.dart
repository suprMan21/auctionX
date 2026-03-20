import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:video_player/video_player.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';
import '../../../../routing/route_names.dart';
import '../providers/video_proof_provider.dart';

class VideoPreviewScreen extends ConsumerStatefulWidget {
  final String tagId;
  final String tagUid;
  final String filePath;
  final int durationSeconds;

  const VideoPreviewScreen({
    super.key,
    required this.tagId,
    required this.tagUid,
    required this.filePath,
    required this.durationSeconds,
  });

  @override
  ConsumerState<VideoPreviewScreen> createState() => _VideoPreviewScreenState();
}

class _VideoPreviewScreenState extends ConsumerState<VideoPreviewScreen> {
  late VideoPlayerController _playerController;
  bool _initialized = false;

  @override
  void initState() {
    super.initState();
    _playerController = VideoPlayerController.file(File(widget.filePath))
      ..initialize().then((_) {
        setState(() => _initialized = true);
        _playerController.setLooping(true);
        _playerController.play();
      });
  }

  @override
  void dispose() {
    _playerController.dispose();
    super.dispose();
  }

  String get _fileSize {
    final file = File(widget.filePath);
    if (!file.existsSync()) return 'N/A';
    final bytes = file.lengthSync();
    if (bytes < 1024 * 1024) {
      return '${(bytes / 1024).toStringAsFixed(1)} KB';
    }
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  String get _durationLabel {
    final m = widget.durationSeconds ~/ 60;
    final s = widget.durationSeconds % 60;
    return '${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: Text('Preview', style: AppTypography.titleLarge),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Colors.white),
          onPressed: () => context.pop(),
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            // Video player
            Expanded(
              child: _initialized
                  ? Center(
                      child: AspectRatio(
                        aspectRatio: _playerController.value.aspectRatio,
                        child: VideoPlayer(_playerController),
                      ),
                    )
                  : const Center(
                      child: CircularProgressIndicator(color: Colors.white),
                    ),
            ),

            // Info bar
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
              color: AppColors.surface,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  _infoItem(Icons.timer, _durationLabel),
                  _infoItem(Icons.storage, _fileSize),
                ],
              ),
            ),

            // Action buttons
            Container(
              padding: const EdgeInsets.all(24),
              color: AppColors.surface,
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () {
                        ref
                            .read(videoProofNotifierProvider.notifier)
                            .retake();
                        context.pop();
                      },
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(color: Colors.white30),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      child: Text(
                        'Retake',
                        style: AppTypography.labelLarge
                            .copyWith(color: Colors.white70),
                      ),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: AppColors.primaryGradient,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: ElevatedButton(
                        onPressed: () {
                          context.push(
                            RouteNames.videoUpload,
                            extra: {
                              'tagId': widget.tagId,
                              'tagUid': widget.tagUid,
                              'filePath': widget.filePath,
                              'durationSeconds':
                                  widget.durationSeconds.toString(),
                            },
                          );
                        },
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.transparent,
                          shadowColor: Colors.transparent,
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                        child: Text('Use This Video',
                            style: AppTypography.labelLarge),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _infoItem(IconData icon, String label) {
    return Row(
      children: [
        Icon(icon, color: Colors.white54, size: 18),
        const SizedBox(width: 6),
        Text(
          label,
          style: AppTypography.bodySmall.copyWith(color: Colors.white70),
        ),
      ],
    );
  }
}
