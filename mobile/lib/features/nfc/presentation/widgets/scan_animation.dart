import 'package:flutter/material.dart';
import '../../../../core/constants/app_colors.dart';

class ScanAnimation extends StatefulWidget {
  const ScanAnimation({super.key});

  @override
  State<ScanAnimation> createState() => _ScanAnimationState();
}

class _ScanAnimationState extends State<ScanAnimation>
    with TickerProviderStateMixin {
  late final AnimationController _controller;
  late final List<Animation<double>> _ringAnimations;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2000),
    )..repeat();

    // Stagger 3 rings
    _ringAnimations = List.generate(3, (i) {
      final start = i * 0.2;
      final end = (start + 0.6).clamp(0.0, 1.0);
      return CurvedAnimation(
        parent: _controller,
        curve: Interval(start, end, curve: Curves.easeOut),
      );
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 200,
      height: 200,
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, child) {
          return Stack(
            alignment: Alignment.center,
            children: [
              // Ripple rings
              for (int i = 0; i < 3; i++)
                _buildRing(i),
              // Center NFC icon
              Container(
                width: 72,
                height: 72,
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      AppColors.primary500,
                      AppColors.accent500,
                    ],
                  ),
                ),
                child: const Icon(
                  Icons.nfc,
                  color: Colors.white,
                  size: 36,
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildRing(int index) {
    final animation = _ringAnimations[index];
    final size = 72.0 + (animation.value * 128.0);
    final opacity = (1.0 - animation.value) * 0.6;

    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(
          color: AppColors.primary500.withValues(alpha: opacity),
          width: 2,
        ),
      ),
    );
  }
}
