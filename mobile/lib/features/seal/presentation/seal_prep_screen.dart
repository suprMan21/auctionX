import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_typography.dart';
import '../../../routing/route_names.dart';
import '../../auth/presentation/widgets/gradient_button.dart';
import '../seal_copy.dart';
import 'seal_take_screen.dart';

/// Before you seal: what to have ready, then a practice run or the real take.
class SealPrepScreen extends StatelessWidget {
  const SealPrepScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Seal a piece')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 32),
          children: [
            Semantics(header: true, child: Text(prepTitle, style: AppTypography.headlineSmall)),
            const SizedBox(height: 8),
            Text(prepIntro, style: AppTypography.bodyLarge.copyWith(color: AppColors.textSecondary)),
            const SizedBox(height: 20),
            for (final p in prepPoints)
              Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: Text.rich(
                  TextSpan(children: [
                    TextSpan(text: '${p.title} ', style: AppTypography.titleMedium),
                    TextSpan(text: p.body, style: AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary)),
                  ]),
                ),
              ),
            const SizedBox(height: 12),
            Text(prepPractice, style: AppTypography.bodyMedium),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: () => context.push(RouteNames.sealTake, extra: const TakeArgs(practice: true)),
              child: const Text('Practice run'),
            ),
            const SizedBox(height: 12),
            GradientButton(
              text: 'I’m ready',
              onPressed: () => context.push(RouteNames.sealTake, extra: const TakeArgs()),
            ),
            const SizedBox(height: 16),
            Text(prepAfter, style: AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary)),
          ],
        ),
      ),
    );
  }
}
