import 'package:flutter/material.dart';

class RecordingOverlay extends StatelessWidget {
  final String tagUid;
  final int elapsedSeconds;

  const RecordingOverlay({
    super.key,
    required this.tagUid,
    required this.elapsedSeconds,
  });

  String get _abbreviatedUid {
    if (tagUid.length <= 8) return tagUid;
    return '${tagUid.substring(0, 4)}...${tagUid.substring(tagUid.length - 4)}';
  }

  String get _timestamp {
    final now = DateTime.now();
    return '${now.year}-${_pad(now.month)}-${_pad(now.day)} '
        '${_pad(now.hour)}:${_pad(now.minute)}:${_pad(now.second)}';
  }

  String _pad(int n) => n.toString().padLeft(2, '0');

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            // Top row: tag UID left, timestamp right
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _overlayText('TAG: $_abbreviatedUid'),
                _overlayText(_timestamp),
              ],
            ),
            // Bottom center: watermark
            _overlayText('AM Verified', fontSize: 18),
          ],
        ),
      ),
    );
  }

  Widget _overlayText(String text, {double fontSize = 12}) {
    return Text(
      text,
      style: TextStyle(
        color: Colors.white.withValues(alpha: 0.7),
        fontSize: fontSize,
        fontWeight: FontWeight.w600,
        shadows: const [
          Shadow(blurRadius: 4, color: Colors.black54),
        ],
      ),
    );
  }
}
