import 'package:flutter/material.dart';
import '../../../../core/constants/app_colors.dart';

/// Holding screen while the app checks its version and the saved session.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Semantics(
          label: 'Loading',
          child: const SizedBox(
            width: 28,
            height: 28,
            child: CircularProgressIndicator(color: AppColors.primary500, strokeWidth: 2.5),
          ),
        ),
      ),
    );
  }
}
