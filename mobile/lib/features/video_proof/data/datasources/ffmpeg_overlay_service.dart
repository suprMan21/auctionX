import 'dart:io';
import 'package:path_provider/path_provider.dart';

/// Burns verification overlay text (tag UID, timestamp, watermark) into a video file.
///
/// TODO: FFmpegKit (arthenica) project is archived and Maven artifacts are offline.
/// When a maintained FFmpeg Flutter package becomes available, replace the stub
/// implementation below with actual drawtext filter processing:
///
///   ffmpeg -y -i input.mp4 -vf "drawtext=text='TAG: XXXX':fontsize=20:..." output.mp4
///
/// The pipeline architecture (burn → compress → upload → confirm) is already wired
/// up — only this service class needs updating.
class FfmpegOverlayService {
  /// Attempts to burn overlay text into the video file.
  ///
  /// Currently returns the input file unchanged since FFmpegKit is unavailable.
  /// The overlay IS still shown as a Flutter widget layer during recording,
  /// so the viewer sees the tag UID + timestamp in the recording UI — it's just
  /// not embedded in the final MP4 file yet.
  Future<String> burnOverlay({
    required String inputPath,
    required String tagUid,
    required DateTime recordingStart,
    required void Function(double) onProgress,
  }) async {
    // Signal progress immediately — no actual processing needed in stub mode
    onProgress(0.5);

    // Verify input file exists
    final inputFile = File(inputPath);
    if (!await inputFile.exists()) {
      throw Exception('Input video file not found: $inputPath');
    }

    // Copy to temp directory with overlay suffix so the pipeline naming stays consistent
    final dir = await getTemporaryDirectory();
    final outputPath = '${dir.path}/proof_overlay.mp4';
    final outputFile = File(outputPath);
    if (await outputFile.exists()) {
      await outputFile.delete();
    }
    await inputFile.copy(outputPath);

    onProgress(1.0);
    return outputPath;
  }
}
