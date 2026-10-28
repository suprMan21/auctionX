import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app_providers.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_typography.dart';
import '../auth/presentation/widgets/auth_text_field.dart';
import '../auth/presentation/widgets/gradient_button.dart';
import '../mfa/data/mfa_models.dart';
import '../mfa/mfa_copy.dart';

/// Opens an `otpauth://` link in whichever app handles it. Swapped in tests.
typedef OtpauthLauncher = Future<bool> Function(Uri uri);

Future<bool> _launchOtpauth(Uri uri) => launchUrl(uri, mode: LaunchMode.externalApplication);

/// Sets up an authenticator app: starts the setup on the server, offers the
/// key (open in an app on this phone, scan the QR code from another device,
/// or type it), then checks one code. Pops with [TotpConfirmed] when done.
class AuthenticatorSetupScreen extends ConsumerStatefulWidget {
  const AuthenticatorSetupScreen({super.key, this.stepUpToken, this.launcher});

  /// Needed unless this is the account's first method.
  final String? stepUpToken;
  final OtpauthLauncher? launcher;

  @override
  ConsumerState<AuthenticatorSetupScreen> createState() => _AuthenticatorSetupScreenState();
}

class _AuthenticatorSetupScreenState extends ConsumerState<AuthenticatorSetupScreen> {
  final _code = TextEditingController();
  TotpSetup? _setup;
  String? _startError;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _start();
  }

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    try {
      final setup = await ref.read(mfaApiProvider).totpSetup(stepUpToken: widget.stepUpToken);
      if (mounted) setState(() => _setup = setup);
    } catch (e) {
      if (mounted) setState(() => _startError = mfaErrorCopy(e));
    }
  }

  Future<void> _open() async {
    final ok = await (widget.launcher ?? _launchOtpauth)(Uri.parse(_setup!.otpauthUri));
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('No authenticator app opened. Install one, or copy the setup key below.'),
      ));
    }
  }

  Future<void> _copyKey() async {
    await Clipboard.setData(ClipboardData(text: _setup!.secret));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Setup key copied.')));
  }

  Future<void> _confirm() async {
    final code = _code.text.trim();
    if (!RegExp(r'^\d{6}$').hasMatch(code)) {
      setState(() => _error = 'Enter the 6-digit code from your authenticator app.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await ref.read(mfaApiProvider).totpConfirm(code);
      if (mounted) Navigator.of(context).pop(result);
    } catch (e) {
      if (mounted) setState(() => _error = mfaErrorCopy(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// "ABCD EFGH …" is easier to type than one long run.
  static String grouped(String secret) =>
      RegExp('.{1,4}').allMatches(secret).map((m) => m.group(0)).join(' ');

  @override
  Widget build(BuildContext context) {
    final setup = _setup;
    return Scaffold(
      appBar: AppBar(title: const Text('Authenticator app')),
      body: SafeArea(
        child: _startError != null
            ? Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Semantics(
                      liveRegion: true,
                      child: Text(_startError!, style: AppTypography.bodyLarge.copyWith(color: AppColors.errorText)),
                    ),
                    const SizedBox(height: 16),
                    OutlinedButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Back')),
                  ],
                ),
              )
            : setup == null
                ? const Center(child: CircularProgressIndicator())
                : ListView(
                    padding: const EdgeInsets.all(24),
                    children: [
                      Semantics(header: true, child: Text('1. Add Authentic Materials', style: AppTypography.titleLarge)),
                      const SizedBox(height: 8),
                      Text(
                        'Open your authenticator app (for example Google Authenticator, Microsoft Authenticator, '
                        '1Password or your phone’s Passwords app) and add this account.',
                        style: AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary),
                      ),
                      const SizedBox(height: 16),
                      GradientButton(text: 'Open in authenticator app', onPressed: _open),
                      const SizedBox(height: 20),
                      Text(
                        'Authenticator app on another device? Scan this:',
                        style: AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary),
                      ),
                      const SizedBox(height: 12),
                      Center(
                        child: QrImageView(
                          data: setup.otpauthUri,
                          size: 200,
                          backgroundColor: Colors.white,
                          semanticsLabel: 'QR code to add Authentic Materials to an authenticator app',
                        ),
                      ),
                      const SizedBox(height: 16),
                      Text('Or type this setup key:', style: AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary)),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Expanded(
                            child: SelectableText(
                              grouped(setup.secret),
                              style: AppTypography.titleMedium.copyWith(
                                fontFamily: 'Courier',
                                fontFamilyFallback: const ['Menlo', 'monospace'],
                              ),
                            ),
                          ),
                          IconButton(onPressed: _copyKey, icon: const Icon(Icons.copy), tooltip: 'Copy setup key'),
                        ],
                      ),
                      const SizedBox(height: 28),
                      Semantics(header: true, child: Text('2. Enter the code it shows', style: AppTypography.titleLarge)),
                      const SizedBox(height: 12),
                      AutofillGroup(
                        child: AuthTextField(
                          controller: _code,
                          label: 'Authenticator app code',
                          keyboardType: TextInputType.number,
                          autofillHints: const [AutofillHints.oneTimeCode],
                          textInputAction: TextInputAction.done,
                          onSubmitted: (_) => _confirm(),
                          enabled: !_busy,
                        ),
                      ),
                      if (_error != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 12),
                          child: Semantics(
                            liveRegion: true,
                            child: Text(_error!, style: AppTypography.bodyMedium.copyWith(color: AppColors.errorText)),
                          ),
                        ),
                      const SizedBox(height: 16),
                      GradientButton(text: 'Turn on', isLoading: _busy, onPressed: _busy ? null : _confirm),
                    ],
                  ),
      ),
    );
  }
}
