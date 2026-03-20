import 'package:flutter/material.dart';

class RecordingControls extends StatelessWidget {
  final bool isRecording;
  final int elapsedSeconds;
  final int minSeconds;
  final VoidCallback onStartStop;

  const RecordingControls({
    super.key,
    required this.isRecording,
    required this.elapsedSeconds,
    this.minSeconds = 15,
    required this.onStartStop,
  });

  bool get _canStop => isRecording && elapsedSeconds >= minSeconds;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        GestureDetector(
          onTap: isRecording && !_canStop ? null : onStartStop,
          child: _RecordButton(
            isRecording: isRecording,
            canStop: _canStop,
          ),
        ),
        if (isRecording && !_canStop) ...[
          const SizedBox(height: 8),
          Text(
            '${minSeconds - elapsedSeconds}s min remaining',
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.6),
              fontSize: 12,
            ),
          ),
        ],
      ],
    );
  }
}

class _RecordButton extends StatefulWidget {
  final bool isRecording;
  final bool canStop;

  const _RecordButton({
    required this.isRecording,
    required this.canStop,
  });

  @override
  State<_RecordButton> createState() => _RecordButtonState();
}

class _RecordButtonState extends State<_RecordButton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulseController;
  late final Animation<double> _pulseAnimation;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1000),
    );
    _pulseAnimation = Tween<double>(begin: 1.0, end: 1.15).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );
  }

  @override
  void didUpdateWidget(_RecordButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isRecording && !_pulseController.isAnimating) {
      _pulseController.repeat(reverse: true);
    } else if (!widget.isRecording) {
      _pulseController.stop();
      _pulseController.reset();
    }
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _pulseAnimation,
      builder: (context, child) {
        final scale =
            widget.isRecording ? _pulseAnimation.value : 1.0;
        return Transform.scale(
          scale: scale,
          child: Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white, width: 4),
            ),
            child: Center(
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                width: widget.isRecording ? 28 : 56,
                height: widget.isRecording ? 28 : 56,
                decoration: BoxDecoration(
                  color: widget.isRecording && !widget.canStop
                      ? Colors.red.withValues(alpha: 0.5)
                      : Colors.red,
                  borderRadius: widget.isRecording
                      ? BorderRadius.circular(6)
                      : BorderRadius.circular(28),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
