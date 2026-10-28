import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/constants/app_colors.dart';
import '../../core/constants/app_typography.dart';
import '../auth/presentation/widgets/gradient_button.dart';

/// New backup codes, shown once. The person can't leave until they say
/// they've saved them (the codes are never shown again).
class BackupCodesScreen extends StatefulWidget {
  const BackupCodesScreen({super.key, required this.codes, this.firstMethod = false});

  final List<String> codes;

  /// Made with the account's first sign-in method (rather than on request).
  final bool firstMethod;

  @override
  State<BackupCodesScreen> createState() => _BackupCodesScreenState();
}

class _BackupCodesScreenState extends State<BackupCodesScreen> {
  bool _saved = false;
  final _shareKey = GlobalKey();

  String get _asText => [
        'Authentic Materials backup codes',
        'Each code works once.',
        '',
        ...widget.codes,
      ].join('\n');

  Future<void> _copy() async {
    await Clipboard.setData(ClipboardData(text: _asText));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Copied. Paste them somewhere safe, then clear your clipboard.')),
    );
  }

  Future<void> _share() async {
    final box = _shareKey.currentContext?.findRenderObject() as RenderBox?;
    await SharePlus.instance.share(ShareParams(
      text: _asText,
      subject: 'Authentic Materials backup codes',
      sharePositionOrigin: box == null ? null : box.localToGlobal(Offset.zero) & box.size,
    ));
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: _saved,
      child: Scaffold(
        appBar: AppBar(title: const Text('Backup codes'), automaticallyImplyLeading: false),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              Semantics(
                header: true,
                child: Text('Save your backup codes', style: AppTypography.headlineSmall),
              ),
              const SizedBox(height: 8),
              Text(
                '${widget.firstMethod ? 'Your second sign-in step is set up. ' : 'Your old backup codes no longer work. '}'
                'If you lose your phone, each of these codes lets you sign in once. '
                'Keep them somewhere safe, like a password manager. You won’t see them again.',
                style: AppTypography.bodyLarge.copyWith(color: AppColors.textSecondary),
              ),
              const SizedBox(height: 20),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppColors.surfaceLight,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppColors.glassBorder),
                ),
                child: Semantics(
                  label: 'Backup codes: ${widget.codes.join(', ')}',
                  excludeSemantics: true,
                  child: Wrap(
                    spacing: 24,
                    runSpacing: 10,
                    children: [
                      for (final code in widget.codes)
                        SizedBox(
                          width: 130,
                          child: Text(
                            code,
                            style: AppTypography.titleMedium.copyWith(
                              fontFamily: 'Courier',
                              fontFamilyFallback: const ['Menlo', 'monospace'],
                              letterSpacing: 1,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _copy,
                      icon: const Icon(Icons.copy, size: 18),
                      label: const Text('Copy'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: OutlinedButton.icon(
                      key: _shareKey,
                      onPressed: _share,
                      icon: const Icon(Icons.ios_share, size: 18),
                      label: const Text('Share'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              CheckboxListTile(
                value: _saved,
                onChanged: (v) => setState(() => _saved = v ?? false),
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                title: const Text('I’ve saved these codes somewhere safe'),
              ),
              const SizedBox(height: 12),
              GradientButton(
                text: 'Done',
                onPressed: _saved ? () => Navigator.of(context).pop() : null,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
