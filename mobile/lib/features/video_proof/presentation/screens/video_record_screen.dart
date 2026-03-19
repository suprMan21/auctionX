import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';
import '../../../../routing/route_names.dart';
import '../providers/video_proof_provider.dart';
import '../providers/video_proof_state.dart';
import '../widgets/recording_controls.dart';
import '../widgets/recording_overlay.dart';
import '../widgets/recording_timer.dart';

class VideoRecordScreen extends ConsumerStatefulWidget {
  final String tagId;
  final String tagUid;

  const VideoRecordScreen({
    super.key,
    required this.tagId,
    required this.tagUid,
  });

  @override
  ConsumerState<VideoRecordScreen> createState() => _VideoRecordScreenState();
}

class _VideoRecordScreenState extends ConsumerState<VideoRecordScreen> {
  @override
  void initState() {
    super.initState();
    // Lock to portrait
    SystemChrome.setPreferredOrientations([
      DeviceOrientation.portraitUp,
    ]);

    // Init camera on first frame
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(videoProofNotifierProvider.notifier).initCamera();
    });
  }

  @override
  void dispose() {
    // Restore orientations
    SystemChrome.setPreferredOrientations(DeviceOrientation.values);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(videoProofNotifierProvider);

    ref.listen<VideoProofState>(videoProofNotifierProvider, (prev, next) {
      if (next is VideoProofStopped) {
        context.push(
          RouteNames.videoPreview,
          extra: {
            'tagId': widget.tagId,
            'tagUid': widget.tagUid,
            'filePath': next.filePath,
            'durationSeconds': next.durationSeconds.toString(),
          },
        );
      }
    });

    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: state.when(
          idle: () => _buildLoading(),
          initializing: () => _buildLoading(),
          ready: (controller) => _buildCamera(controller, 0, false),
          recording: (controller, elapsed) =>
              _buildCamera(controller, elapsed, true),
          stopped: (_, __) => _buildLoading(),
          burning: (_) => _buildLoading(),
          compressing: (_) => _buildLoading(),
          compressed: (_, __, ___) => _buildLoading(),
          uploading: (_) => _buildLoading(),
          complete: (_) => _buildLoading(),
          error: (message) => _buildError(message),
          permissionDenied: () => _buildPermissionDenied(),
        ),
      ),
    );
  }

  Widget _buildCamera(
    CameraController controller,
    int elapsed,
    bool isRecording,
  ) {
    return Stack(
      fit: StackFit.expand,
      children: [
        // Camera preview
        ClipRect(
          child: FittedBox(
            fit: BoxFit.cover,
            child: SizedBox(
              width: controller.value.previewSize?.height ?? 1920,
              height: controller.value.previewSize?.width ?? 1080,
              child: CameraPreview(controller),
            ),
          ),
        ),

        // Overlay (display-only, not burned into video)
        if (isRecording)
          RecordingOverlay(
            tagUid: widget.tagUid,
            elapsedSeconds: elapsed,
          ),

        // Top bar with back button and timer
        Positioned(
          top: 16,
          left: 0,
          right: 0,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              IconButton(
                icon: const Icon(Icons.arrow_back, color: Colors.white),
                onPressed: isRecording ? null : () => context.pop(),
              ),
              if (isRecording) RecordingTimer(elapsedSeconds: elapsed),
              const SizedBox(width: 48), // Balance
            ],
          ),
        ),

        // Bottom controls
        Positioned(
          bottom: 40,
          left: 0,
          right: 0,
          child: Center(
            child: RecordingControls(
              isRecording: isRecording,
              elapsedSeconds: elapsed,
              minSeconds: ref.read(videoProofNotifierProvider.notifier).minDuration,
              onStartStop: () {
                final notifier =
                    ref.read(videoProofNotifierProvider.notifier);
                if (isRecording) {
                  notifier.stopRecording();
                } else {
                  notifier.startRecording();
                }
              },
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildLoading() {
    return const Center(
      child: CircularProgressIndicator(color: Colors.white),
    );
  }

  Widget _buildError(String message) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, color: AppColors.error, size: 64),
            const SizedBox(height: 16),
            Text(
              message,
              style: AppTypography.bodyMedium.copyWith(color: Colors.white),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: () =>
                  ref.read(videoProofNotifierProvider.notifier).initCamera(),
              child: const Text('Retry'),
            ),
            const SizedBox(height: 12),
            TextButton(
              onPressed: () => context.pop(),
              child: const Text('Go Back',
                  style: TextStyle(color: Colors.white70)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPermissionDenied() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.videocam_off, color: AppColors.warning, size: 64),
            const SizedBox(height: 16),
            Text(
              'Camera and microphone permissions are required to record video proof.',
              style: AppTypography.bodyMedium.copyWith(color: Colors.white),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: () => openAppSettings(),
              child: const Text('Open Settings'),
            ),
            const SizedBox(height: 12),
            TextButton(
              onPressed: () => context.pop(),
              child: const Text('Go Back',
                  style: TextStyle(color: Colors.white70)),
            ),
          ],
        ),
      ),
    );
  }
}
