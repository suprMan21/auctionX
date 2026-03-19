import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:flutter/painting.dart';
import 'package:watermark_kit/watermark_kit.dart';

/// Burns verification overlay text (tag UID, timestamp, watermark) into a video file
/// using watermark_kit (native MediaCodec on Android, AVFoundation on iOS).
class FfmpegOverlayService {
  final WatermarkKit _wm = WatermarkKit();

  /// Burns tag UID, timestamp, and "AM Verified" watermark into the video.
  /// Returns the path to the output file.
  Future<String> burnOverlay({
    required String inputPath,
    required String tagUid,
    required DateTime recordingStart,
    required void Function(double) onProgress,
  }) async {
    // Abbreviate UID for display
    final uidDisplay = tagUid.length > 8
        ? 'TAG: ${tagUid.substring(0, 4)}...${tagUid.substring(tagUid.length - 4)}'
        : 'TAG: $tagUid';

    final timestamp =
        '${recordingStart.year}-${recordingStart.month.toString().padLeft(2, '0')}-${recordingStart.day.toString().padLeft(2, '0')} '
        '${recordingStart.hour.toString().padLeft(2, '0')}:${recordingStart.minute.toString().padLeft(2, '0')}:${recordingStart.second.toString().padLeft(2, '0')}';

    // Create a transparent PNG overlay image with all 3 text elements
    final overlayBytes = await _renderOverlayImage(
      uidText: uidDisplay,
      timestampText: timestamp,
      watermarkText: 'AM Verified',
    );

    onProgress(0.1);

    // Burn the overlay into the video using native APIs
    final task = await _wm.composeVideo(
      inputVideoPath: inputPath,
      watermarkImage: overlayBytes,
      anchor: 'center',
      widthPercent: 1.0,
      opacity: 1.0,
      codec: 'h264',
    );

    // Listen to progress
    task.progress.listen((p) {
      // Scale progress from 0.1 to 1.0
      onProgress(0.1 + p * 0.9);
    });

    final result = await task.done;
    onProgress(1.0);
    return result.path;
  }

  /// Renders a transparent PNG with text at bottom-left, bottom-right, and bottom-center.
  /// Uses a 1080x1920 canvas (standard portrait video); watermark_kit scales to match.
  Future<Uint8List> _renderOverlayImage({
    required String uidText,
    required String timestampText,
    required String watermarkText,
  }) async {
    const width = 1080.0;
    const height = 1920.0;
    const bottomPadding = 80.0;
    const sidePadding = 30.0;

    final recorder = ui.PictureRecorder();
    final canvas = ui.Canvas(recorder, const ui.Rect.fromLTWH(0, 0, width, height));

    // Semi-transparent black bar at bottom for text readability
    final barPaint = ui.Paint()..color = const ui.Color(0x66000000);
    canvas.drawRect(
      const ui.Rect.fromLTWH(0, height - 120, width, 120),
      barPaint,
    );

    // Text style for main elements
    const mainFontSize = 28.0;
    const watermarkFontSize = 22.0;

    // Bottom-left: Tag UID
    _drawText(
      canvas,
      uidText,
      mainFontSize,
      const ui.Color(0xCCFFFFFF),
      const ui.Offset(sidePadding, height - bottomPadding),
      TextAlign.left,
    );

    // Bottom-right: Timestamp
    _drawText(
      canvas,
      timestampText,
      mainFontSize,
      const ui.Color(0xCCFFFFFF),
      const ui.Offset(width - sidePadding, height - bottomPadding),
      TextAlign.right,
    );

    // Bottom-center: Watermark
    _drawText(
      canvas,
      watermarkText,
      watermarkFontSize,
      const ui.Color(0x80FFFFFF),
      const ui.Offset(width / 2, height - bottomPadding + 34),
      TextAlign.center,
    );

    final picture = recorder.endRecording();
    final image = await picture.toImage(width.toInt(), height.toInt());
    final byteData = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    picture.dispose();

    if (byteData == null) {
      throw Exception('Failed to render overlay image');
    }

    return byteData.buffer.asUint8List();
  }

  void _drawText(
    ui.Canvas canvas,
    String text,
    double fontSize,
    ui.Color color,
    ui.Offset position,
    TextAlign align,
  ) {
    final builder = ui.ParagraphBuilder(
      ui.ParagraphStyle(
        textAlign: align,
        fontSize: fontSize,
        fontFamily: 'Roboto',
      ),
    );

    // Add shadow for visibility
    builder.pushStyle(ui.TextStyle(
      color: const ui.Color(0x99000000),
      fontSize: fontSize,
      fontFamily: 'Roboto',
    ));
    builder.addText(text);
    builder.pop();

    final shadowParagraph = builder.build();
    shadowParagraph.layout(const ui.ParagraphConstraints(width: 600));

    // Draw shadow offset
    final shadowOffset = ui.Offset(
      align == TextAlign.right
          ? position.dx - shadowParagraph.maxIntrinsicWidth + 1.5
          : align == TextAlign.center
              ? position.dx - shadowParagraph.maxIntrinsicWidth / 2 + 1.5
              : position.dx + 1.5,
      position.dy + 1.5,
    );
    canvas.drawParagraph(shadowParagraph, shadowOffset);

    // Draw main text
    final mainBuilder = ui.ParagraphBuilder(
      ui.ParagraphStyle(
        textAlign: align,
        fontSize: fontSize,
        fontFamily: 'Roboto',
      ),
    );
    mainBuilder.pushStyle(ui.TextStyle(
      color: color,
      fontSize: fontSize,
      fontFamily: 'Roboto',
    ));
    mainBuilder.addText(text);
    mainBuilder.pop();

    final mainParagraph = mainBuilder.build();
    mainParagraph.layout(const ui.ParagraphConstraints(width: 600));

    final mainOffset = ui.Offset(
      align == TextAlign.right
          ? position.dx - mainParagraph.maxIntrinsicWidth
          : align == TextAlign.center
              ? position.dx - mainParagraph.maxIntrinsicWidth / 2
              : position.dx,
      position.dy,
    );
    canvas.drawParagraph(mainParagraph, mainOffset);
  }
}
