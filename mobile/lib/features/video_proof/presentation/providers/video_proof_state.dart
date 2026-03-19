import 'package:camera/camera.dart';
import 'package:freezed_annotation/freezed_annotation.dart';
import '../../domain/entities/upload_progress.dart';

part 'video_proof_state.freezed.dart';

@freezed
sealed class VideoProofState with _$VideoProofState {
  const factory VideoProofState.idle() = VideoProofIdle;
  const factory VideoProofState.initializing() = VideoProofInitializing;
  const factory VideoProofState.ready(CameraController controller) =
      VideoProofReady;
  const factory VideoProofState.recording(
    CameraController controller,
    int elapsedSeconds,
  ) = VideoProofRecording;
  const factory VideoProofState.stopped(
    String filePath,
    int durationSeconds,
  ) = VideoProofStopped;
  const factory VideoProofState.burning(double progress) = VideoProofBurning;
  const factory VideoProofState.compressing(double progress) =
      VideoProofCompressing;
  const factory VideoProofState.compressed(
    String filePath,
    int fileSize,
    int durationSeconds,
  ) = VideoProofCompressed;
  const factory VideoProofState.uploading(UploadProgress progress) =
      VideoProofUploading;
  const factory VideoProofState.complete(String publicUrl) =
      VideoProofComplete;
  const factory VideoProofState.error(String message) = VideoProofError;
  const factory VideoProofState.permissionDenied() = VideoProofPermissionDenied;
}
