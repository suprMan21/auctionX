import 'package:flutter/material.dart';

class RecordingTimer extends StatelessWidget {
  final int elapsedSeconds;
  final int maxSeconds;

  const RecordingTimer({
    super.key,
    required this.elapsedSeconds,
    this.maxSeconds = 60,
  });

  @override
  Widget build(BuildContext context) {
    final minutes = elapsedSeconds ~/ 60;
    final seconds = elapsedSeconds % 60;
    final timeStr =
        '${minutes.toString().padLeft(2, '0')}:${seconds.toString().padLeft(2, '0')}';
    final isWarning = elapsedSeconds >= 50;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: 64,
          height: 64,
          child: Stack(
            alignment: Alignment.center,
            children: [
              CircularProgressIndicator(
                value: elapsedSeconds / maxSeconds,
                strokeWidth: 3,
                backgroundColor: Colors.white24,
                valueColor: AlwaysStoppedAnimation(
                  isWarning ? Colors.red : Colors.white,
                ),
              ),
              Text(
                timeStr,
                style: TextStyle(
                  color: isWarning ? Colors.red : Colors.white,
                  fontSize: 14,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
