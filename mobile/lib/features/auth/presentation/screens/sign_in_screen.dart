import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app_providers.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';
import '../../../../shared/widgets/open_link.dart';
import '../../data/auth_service.dart';
import '../widgets/auth_text_field.dart';
import '../widgets/gradient_button.dart';

/// Password sign-in. Creating an account and resetting a password happen on
/// the website (Boss 2026-10-28), which links back here when done.
class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key});

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _obscure = true;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final hint = ref.read(emailHintProvider);
    if (hint != null) _email.text = hint;
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final email = _email.text.trim();
    final password = _password.text;
    if (email.isEmpty || password.isEmpty) {
      setState(() => _error = 'Enter your email and password.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authControllerProvider.notifier).signIn(email, password);
      TextInput.finishAutofillContext();
      // The router moves on when the auth state changes.
    } on SignInFailure catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final links = ref.watch(webLinksProvider);
    // A new email hint (from an "Open the app" link) fills the field.
    ref.listen<String?>(emailHintProvider, (_, next) {
      if (next != null) _email.text = next;
    });

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: AutofillGroup(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Semantics(
                      header: true,
                      child: Text('Sign in', style: AppTypography.headlineMedium, textAlign: TextAlign.center),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Authentic Materials for creators',
                      style: AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 32),
                    AuthTextField(
                      controller: _email,
                      label: 'Email',
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.email, AutofillHints.username],
                      textInputAction: TextInputAction.next,
                      enabled: !_busy,
                    ),
                    const SizedBox(height: 16),
                    AuthTextField(
                      controller: _password,
                      label: 'Password',
                      obscureText: _obscure,
                      autofillHints: const [AutofillHints.password],
                      textInputAction: TextInputAction.done,
                      onSubmitted: (_) => _submit(),
                      enabled: !_busy,
                      suffixIcon: IconButton(
                        tooltip: _obscure ? 'Show password' : 'Hide password',
                        icon: Icon(
                          _obscure ? Icons.visibility_off_outlined : Icons.visibility_outlined,
                          color: AppColors.textSecondary,
                        ),
                        onPressed: () => setState(() => _obscure = !_obscure),
                      ),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 12),
                      Semantics(
                        liveRegion: true,
                        child: Text(_error!, style: AppTypography.bodyMedium.copyWith(color: AppColors.errorText)),
                      ),
                    ],
                    const SizedBox(height: 24),
                    GradientButton(text: 'Sign in', isLoading: _busy, onPressed: _busy ? null : _submit),
                    const SizedBox(height: 8),
                    TextButton(
                      onPressed: () => openExternal(context, links.forgotPassword),
                      child: const Text('Forgot password?'),
                    ),
                    const SizedBox(height: 24),
                    Text(
                      'New to Authentic Materials?',
                      style: AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary),
                      textAlign: TextAlign.center,
                    ),
                    TextButton(
                      onPressed: () => openExternal(context, links.signUp),
                      child: const Text('Create an account on our website'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
