import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';
import '../providers/auth_provider.dart';
import '../providers/auth_state.dart';
import '../widgets/auth_text_field.dart';
import '../widgets/gradient_button.dart';

class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() =>
      _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _emailController = TextEditingController();
  bool _sent = false;

  @override
  void dispose() {
    _emailController.dispose();
    super.dispose();
  }

  void _handleReset() {
    final email = _emailController.text.trim();
    if (email.isEmpty) return;

    ref.read(authNotifierProvider.notifier).resetPassword(email: email);
    setState(() => _sent = true);
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authNotifierProvider);
    final isLoading = authState == const AuthState.loading();

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 32),
              Text('Reset Password', style: AppTypography.headlineMedium),
              const SizedBox(height: 8),
              Text(
                'Enter your email and we\'ll send you a reset link',
                style: AppTypography.bodyMedium
                    .copyWith(color: AppColors.textSecondary),
              ),
              const SizedBox(height: 32),
              if (_sent) ...[
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: AppColors.success.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                        color: AppColors.success.withValues(alpha: 0.3)),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.check_circle_outline,
                          color: AppColors.success),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          'If an account exists with that email, you\'ll receive a reset link shortly.',
                          style: AppTypography.bodySmall
                              .copyWith(color: AppColors.success),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),
              ],
              AuthTextField(
                controller: _emailController,
                hintText: 'Email address',
                keyboardType: TextInputType.emailAddress,
              ),
              const SizedBox(height: 24),
              GradientButton(
                text: _sent ? 'Resend Link' : 'Send Reset Link',
                isLoading: isLoading,
                onPressed: isLoading ? null : _handleReset,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
