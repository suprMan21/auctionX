import 'package:flutter/material.dart';
import '../../core/constants/app_colors.dart';

class LoadingIndicator extends StatelessWidget {
  final double size;

  const LoadingIndicator({super.key, this.size = 24});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: const CircularProgressIndicator(
        color: AppColors.primary500,
        strokeWidth: 2.5,
      ),
    );
  }
}
