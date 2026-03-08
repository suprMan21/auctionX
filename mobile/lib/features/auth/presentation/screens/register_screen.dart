import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';
import '../../../../routing/route_names.dart';
import '../providers/auth_provider.dart';
import '../providers/auth_state.dart';
import '../widgets/auth_text_field.dart';
import '../widgets/gradient_button.dart';

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmController = TextEditingController();
  bool _obscurePassword = true;
  bool _ageVerified = false;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  void _handleRegister() {
    final email = _emailController.text.trim();
    final password = _passwordController.text;
    final confirm = _confirmController.text;

    if (email.isEmpty || password.isEmpty) return;
    if (password != confirm) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Passwords do not match'),
          backgroundColor: AppColors.error,
        ),
      );
      return;
    }
    if (!_ageVerified) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('You must verify your age to continue'),
          backgroundColor: AppColors.error,
        ),
      );
      return;
    }

    ref.read(authNotifierProvider.notifier).signUp(
          email: email,
          password: password,
        );
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authNotifierProvider);
    final isLoading = authState == const AuthState.loading();

    ref.listen<AuthState>(authNotifierProvider, (prev, next) {
      next.whenOrNull(
        error: (message) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
                content: Text(message), backgroundColor: AppColors.error),
          );
        },
      );
    });

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  width: 80,
                  height: 80,
                  decoration: BoxDecoration(
                    gradient: AppColors.primaryGradient,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Icon(Icons.person_add_outlined,
                      color: Colors.white, size: 40),
                ),
                const SizedBox(height: 24),
                Text('Create Account', style: AppTypography.headlineMedium),
                const SizedBox(height: 8),
                Text(
                  'Join the marketplace',
                  style: AppTypography.bodyMedium
                      .copyWith(color: AppColors.textSecondary),
                ),
                const SizedBox(height: 40),
                Container(
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    color: AppColors.glassBg,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: AppColors.glassBorder),
                  ),
                  child: Column(
                    children: [
                      AuthTextField(
                        controller: _emailController,
                        hintText: 'Email address',
                        keyboardType: TextInputType.emailAddress,
                      ),
                      const SizedBox(height: 16),
                      AuthTextField(
                        controller: _passwordController,
                        hintText: 'Password',
                        obscureText: _obscurePassword,
                        suffixIcon: IconButton(
                          icon: Icon(
                            _obscurePassword
                                ? Icons.visibility_off_outlined
                                : Icons.visibility_outlined,
                            color: AppColors.textTertiary,
                          ),
                          onPressed: () =>
                              setState(() => _obscurePassword = !_obscurePassword),
                        ),
                      ),
                      const SizedBox(height: 16),
                      AuthTextField(
                        controller: _confirmController,
                        hintText: 'Confirm password',
                        obscureText: true,
                      ),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          SizedBox(
                            width: 24,
                            height: 24,
                            child: Checkbox(
                              value: _ageVerified,
                              onChanged: (v) =>
                                  setState(() => _ageVerified = v ?? false),
                              activeColor: AppColors.primary500,
                              side: const BorderSide(
                                  color: AppColors.glassBorder),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              'I confirm I am 18 years or older',
                              style: AppTypography.bodySmall
                                  .copyWith(color: AppColors.textSecondary),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 24),
                      GradientButton(
                        text: 'Create Account',
                        isLoading: isLoading,
                        onPressed: isLoading ? null : _handleRegister,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      'Already have an account? ',
                      style: AppTypography.bodyMedium
                          .copyWith(color: AppColors.textSecondary),
                    ),
                    GestureDetector(
                      onTap: () => context.go(RouteNames.login),
                      child: Text(
                        'Sign In',
                        style: AppTypography.labelLarge
                            .copyWith(color: AppColors.primary500),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
