import 'dart:async';
import 'dart:io';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:video_compress/video_compress.dart';
import '../../../../core/network/api_client.dart';
import '../../data/datasources/camera_datasource.dart';
import '../../data/datasources/ffmpeg_overlay_service.dart';
import '../../data/datasources/video_proof_remote_datasource.dart';
import '../../data/repositories/video_proof_repository_impl.dart';
import '../../domain/entities/upload_progress.dart';
import '../../domain/repositories/video_proof_repository.dart';

export '../../domain/entities/upload_progress.dart';

import 'video_proof_state.dart';

final videoProofRepositoryProvider = Provider<VideoProofRepository>((ref) {
  return VideoProofRepositoryImpl(
    VideoProofRemoteDatasource(ref.watch(_apiClientProvider)),
  );
});

final _apiClientProvider = Provider<ApiClient>((ref) => ApiClient());

final videoProofNotifierProvider = StateNotifierProvider.autoDispose<
    VideoProofNotifier, VideoProofState>((ref) {
  final repo = ref.watch(videoProofRepositoryProvider);
  return VideoProofNotifier(repo);
});

class VideoProofNotifier extends StateNotifier<VideoProofState> {
  final VideoProofRepository _repository;
  final CameraDatasource _camera = CameraDatasource();
  final FfmpegOverlayService _ffmpeg = FfmpegOverlayService();
  Timer? _timer;
  int _elapsed = 0;
  DateTime? _recordingStartTime;
  Subscription? _compressSubscription;
  static const int _maxDuration = 60;
  static const int _minDuration = 15;

  int get minDuration => _minDuration;

  VideoProofNotifier(this._repository) : super(const VideoProofState.idle());

  Future<void> initCamera() async {
    state = const VideoProofState.initializing();

    // Request permissions
    final cameraStatus = await Permission.camera.request();
    final micStatus = await Permission.microphone.request();

    if (!cameraStatus.isGranted || !micStatus.isGranted) {
      state = const VideoProofState.permissionDenied();
      return;
    }

    try {
      final controller = await _camera.initialize();
      if (mounted) {
        state = VideoProofState.ready(controller);
      }
    } catch (e) {
      if (mounted) {
        state = VideoProofState.error('Failed to initialize camera: $e');
      }
    }
  }

  Future<void> startRecording() async {
    final current = state;
    if (current is! VideoProofReady) return;

    try {
      await _camera.startRecording();
      _elapsed = 0;
      _recordingStartTime = DateTime.now();
      state = VideoProofState.recording(current.controller, _elapsed);

      _timer = Timer.periodic(const Duration(seconds: 1), (_) {
        _elapsed++;
        if (_elapsed >= _maxDuration) {
          stopRecording();
        } else if (mounted) {
          state = VideoProofState.recording(current.controller, _elapsed);
        }
      });
    } catch (e) {
      if (mounted) {
        state = VideoProofState.error('Failed to start recording: $e');
      }
    }
  }

  Future<void> stopRecording() async {
    _timer?.cancel();
    _timer = null;

    try {
      final file = await _camera.stopRecording();
      if (mounted) {
        state = VideoProofState.stopped(file.path, _elapsed);
      }
    } catch (e) {
      if (mounted) {
        state = VideoProofState.error('Failed to stop recording: $e');
      }
    }
  }

  Future<void> burnOverlay(String filePath, String tagUid) async {
    state = const VideoProofState.burning(0.0);

    try {
      final burnedPath = await _ffmpeg.burnOverlay(
        inputPath: filePath,
        tagUid: tagUid,
        recordingStart: _recordingStartTime ?? DateTime.now(),
        onProgress: (progress) {
          if (mounted) {
            state = VideoProofState.burning(progress);
          }
        },
      );

      if (mounted) {
        await compressVideo(burnedPath);
      }
    } catch (e) {
      if (mounted) {
        // Fall back to compressing without overlay
        state = VideoProofState.error('Overlay burn failed: $e');
      }
    }
  }

  Future<void> compressVideo(String filePath) async {
    state = const VideoProofState.compressing(0.0);

    _compressSubscription = VideoCompress.compressProgress$.subscribe((double progress) {
      if (mounted) {
        state = VideoProofState.compressing(progress / 100.0);
      }
    });

    try {
      final info = await VideoCompress.compressVideo(
        filePath,
        quality: VideoQuality.MediumQuality,
        deleteOrigin: false,
      );

      _compressSubscription?.unsubscribe();
      _compressSubscription = null;

      if (info == null || info.file == null) {
        // Compression failed — try raw file if small enough
        final rawSize = await File(filePath).length();
        if (rawSize <= 50 * 1024 * 1024) {
          if (mounted) {
            state = VideoProofState.compressed(filePath, rawSize, _elapsed);
          }
        } else {
          if (mounted) {
            state = const VideoProofState.error(
              'Video compression failed and file exceeds 50MB limit.',
            );
          }
        }
        return;
      }

      final compressedSize = await info.file!.length();
      if (mounted) {
        state = VideoProofState.compressed(
          info.file!.path,
          compressedSize,
          _elapsed,
        );
      }
    } catch (e) {
      _compressSubscription?.unsubscribe();
      _compressSubscription = null;
      // Fall back to raw file
      try {
        final rawSize = await File(filePath).length();
        if (rawSize <= 50 * 1024 * 1024 && mounted) {
          state = VideoProofState.compressed(filePath, rawSize, _elapsed);
        } else if (mounted) {
          state = VideoProofState.error('Compression failed: $e');
        }
      } catch (_) {
        if (mounted) {
          state = VideoProofState.error('Compression failed: $e');
        }
      }
    }
  }

  Future<void> uploadVideo({
    required String tagId,
    required String filePath,
    required int fileSize,
  }) async {
    // Request presigned URL right before upload
    final urlResult = await _repository.requestUploadUrl(
      tagId: tagId,
      contentType: 'video/mp4',
      fileSize: fileSize,
    );

    final proof = urlResult.fold(
      (failure) {
        if (mounted) {
          state = VideoProofState.error(failure.message);
        }
        return null;
      },
      (proof) => proof,
    );
    if (proof == null || proof.uploadUrl == null) return;

    state = const VideoProofState.uploading(
      UploadProgress(bytesSent: 0, totalBytes: 0),
    );

    await for (final result in _repository.uploadVideo(
      uploadUrl: proof.uploadUrl!,
      filePath: filePath,
      contentType: 'video/mp4',
    )) {
      result.fold(
        (failure) {
          if (mounted) {
            state = VideoProofState.error(failure.message);
          }
        },
        (progress) {
          if (mounted) {
            state = VideoProofState.uploading(progress);
          }
        },
      );

      // Break on error
      if (state is VideoProofError) return;
    }

    // Confirm the upload with backend
    if (mounted && state is VideoProofUploading && proof.proofId != null) {
      final confirmResult =
          await _repository.confirmUpload(proofId: proof.proofId!);
      confirmResult.fold(
        (failure) {
          if (mounted) {
            // Upload succeeded but confirmation failed — still show success with note
            state = VideoProofState.complete(proof.publicUrl ?? '');
          }
        },
        (_) {
          if (mounted) {
            state = VideoProofState.complete(proof.publicUrl ?? '');
          }
        },
      );
    } else if (mounted && state is VideoProofUploading) {
      state = VideoProofState.complete(proof.publicUrl ?? '');
    }
  }

  void retake() async {
    try {
      final controller = await _camera.initialize();
      if (mounted) {
        state = VideoProofState.ready(controller);
      }
    } catch (e) {
      if (mounted) {
        state = VideoProofState.error('Failed to reinitialize camera: $e');
      }
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _compressSubscription?.unsubscribe();
    _camera.dispose();
    VideoCompress.cancelCompression();
    super.dispose();
  }
}
