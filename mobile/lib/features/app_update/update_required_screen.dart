import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app_providers.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_typography.dart';
import '../../shared/widgets/open_link.dart';
import '../auth/presentation/widgets/gradient_button.dart';
import 'update_gate.dart';

/// Shown when this build is older than the server's minimum. Nothing else in
/// the app is reachable until the person updates.
class UpdateRequiredScreen extends ConsumerWidget {
  const UpdateRequiredScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(updateGateProvider);
    final url = state is UpdateRequired ? state.updateUrl : null;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Icon(Icons.system_update_outlined, size: 56, color: AppColors.accent400),
                  const SizedBox(height: 24),
                  Semantics(
                    header: true,
                    child: Text('Update the app', style: AppTypography.headlineMedium, textAlign: TextAlign.center),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'This version of Authentic Materials is too old to keep your account safe. '
                    'Update it to carry on.',
                    style: AppTypography.bodyLarge.copyWith(color: AppColors.textSecondary),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 32),
                  if (url != null)
                    GradientButton(text: 'Update now', onPressed: () => openExternal(context, url))
                  else
                    Text(
                      'Open the App Store or Google Play to update.',
                      style: AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary),
                      textAlign: TextAlign.center,
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
