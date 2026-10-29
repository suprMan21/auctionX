import 'package:flutter/material.dart';

import '../../core/constants/app_colors.dart';
import '../../core/constants/app_typography.dart';
import '../../shared/seal/seal_badge.dart';
import '../../shared/seal/seal_spec.dart';

/// Test builds only (never in a prod build): the seal as the app draws it, for checking on a
/// real phone before S-MOB2 uses it. Uses chip_004's public seal code and spec.
class SealPreviewScreen extends StatefulWidget {
  const SealPreviewScreen({super.key});

  @override
  State<SealPreviewScreen> createState() => _SealPreviewScreenState();
}

class _SealPreviewScreenState extends State<SealPreviewScreen> {
  int _run = 0;

  @override
  Widget build(BuildContext context) {
    final reduce = sealReduceMotion(context);
    final note = AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary);
    return Scaffold(
      appBar: AppBar(title: const Text('Seal preview')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Text('Test builds only.', style: note),
            const SizedBox(height: 24),
            Semantics(header: true, child: Text('Verified', style: AppTypography.titleLarge)),
            const SizedBox(height: 4),
            Text(
              reduce
                  ? 'Reduce Motion is on, so nothing moves.'
                  : 'Rings turn, the colours shift, and a glint crosses 1 s after it appears, then every 30 s.',
              style: note,
            ),
            const SizedBox(height: 24),
            Center(
              child: SealBadge(
                key: ValueKey(_run),
                code: _previewCode,
                spec: _previewSpec,
                size: 220,
                label: 'Verified seal $_previewCode',
              ),
            ),
            const SizedBox(height: 16),
            Center(
              child: TextButton(onPressed: () => setState(() => _run++), child: const Text('Show again')),
            ),
            const SizedBox(height: 32),
            Semantics(header: true, child: Text('Sealed', style: AppTypography.titleLarge)),
            const SizedBox(height: 4),
            Text('Still and muted. Never says Verified.', style: note),
            const SizedBox(height: 24),
            Center(
              child: SealBadge(
                code: _previewCode,
                spec: _previewSpec,
                state: SealState.sealed,
                size: 220,
                label: 'Seal $_previewCode',
              ),
            ),
            const SizedBox(height: 32),
            Semantics(header: true, child: Text('Small sizes', style: AppTypography.titleLarge)),
            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                SealBadge(code: _previewCode, spec: _previewSpec, size: 88),
                SealBadge(code: _previewCode, spec: _previewSpec, size: 44),
                SealBadge(code: _previewCode, spec: _previewSpec, state: SealState.sealed, size: 44),
                const SealBadge(state: SealState.sealed, size: 44),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

const _previewCode = 'WAV4-F6TT';

final SealSpec? _previewSpec = SealSpec.tryParse(const {
  'v': 1,
  'colors': 'am-default',
  'pattern': {
    'kind': 'hypotrochoid',
    'version': 1,
    'paths': [_outer, _inner],
  },
});

// chip_004's stored pattern (public; built from its seal code by backend/src/lib/seal/sealSpec.ts).
const _outer =
    'M81.5 40.5l-.6-.4l-.8-.2l-1 .1l-1.1 .4l-1.1 .7l-1.1 1.1l-1.2 1.3l-1 1.5l-.8 1.9l-.7 2l-.5 2.2l-.3 2.4l0 2.4l.2 2.4l.5 2.4l.7 2.3l.9 2.1l1.2 2l1.2 1.8l1.4 1.5l1.4 1.2l1.5 .9l1.3 .6l1.3 .4l1.2 .1l.9-.2l.8-.4l.4-.6l.2-.7l-.2-.8l-.4-.9l-.8-.8l-1.1-.8l-1.4-.7l-1.6-.5l-1.9-.3l-2-.1l-2.2 .1l-2.2 .4l-2.2 .6l-2.3 .9l-2.1 1.2l-2 1.3l-1.9 1.6l-1.6 1.7l-1.4 1.7l-1.1 1.9l-.9 1.8l-.6 1.8l-.3 1.7l-.1 1.5l.2 1.4l.4 1l.5 .9l.7 .5l.7 .2l.7-.2l.7-.4l.6-.8l.5-1l.3-1.3l.1-1.5l-.2-1.7l-.4-1.9l-.6-1.9l-1-1.9l-1.2-2l-1.5-1.8l-1.7-1.7l-1.8-1.6l-2.1-1.3l-2.1-1.1l-2.2-.9l-2.2-.6l-2.1-.3l-2-.1l-1.9 .1l-1.7 .4l-1.4 .5l-1.2 .7l-.8 .7l-.6 .8l-.2 .8l.1 .8l.4 .6l.7 .5l.9 .2l1.1 .1l1.4-.2l1.4-.5l1.5-.8l1.6-1.1l1.5-1.4l1.4-1.6l1.3-1.8l1.2-2.1l.9-2.2l.7-2.3l.5-2.4l.2-2.4l0-2.4l-.3-2.2l-.5-2.1l-.7-1.9l-.9-1.7l-.9-1.4l-1.1-1.1l-1-.8l-1.1-.5l-.9-.2l-.8 0l-.7 .4l-.4 .6l-.2 .8l.1 1l.4 1.1l.7 1.1l1.1 1.1l1.3 1.2l1.5 1l1.9 .8l2 .7l2.2 .5l2.4 .3l2.4 0l2.4-.2l2.4-.5l2.3-.7l2.1-.9l2-1.2l1.8-1.2l1.5-1.4l1.2-1.4l.9-1.5l.6-1.3l.4-1.3l.1-1.2l-.2-.9l-.4-.8l-.6-.4l-.7-.2l-.8 .2l-.9 .4l-.8 .8l-.8 1.1l-.7 1.4l-.5 1.6l-.3 1.9l-.1 2l.1 2.2l.4 2.2l.6 2.2l.9 2.3l1.2 2.1l1.3 2l1.6 1.9l1.7 1.6l1.7 1.4l1.9 1.1l1.8 .9l1.8 .6l1.7 .3l1.5 .1l1.4-.2l1-.4l.9-.5l.5-.7l.2-.7l-.2-.7l-.4-.7l-.8-.6l-1-.5l-1.3-.3l-1.5-.1l-1.7 .2l-1.9 .4l-1.9 .6l-1.9 1l-2 1.2l-1.8 1.5l-1.7 1.7l-1.6 1.8l-1.3 2.1l-1.1 2.1l-.9 2.2l-.6 2.2l-.3 2.1l-.1 2l.1 1.9l.4 1.7l.5 1.4l.7 1.2l.7 .8l.8 .6l.8 .2l.8-.1l.6-.4l.5-.7l.2-.9l.1-1.1l-.2-1.4l-.5-1.4l-.8-1.5l-1.1-1.6l-1.4-1.5l-1.6-1.4l-1.8-1.3l-2.1-1.2l-2.2-.9l-2.3-.7l-2.4-.5l-2.4-.2l-2.4 0l-2.2 .3l-2.1 .5l-1.9 .7l-1.7 .9l-1.4 .9l-1.1 1.1l-.8 1l-.5 1.1l-.2 .9l0 .8l.4 .7l.6 .4l.8 .2l1-.1l1.1-.4l1.1-.7l1.1-1.1l1.2-1.3l1-1.5l.8-1.9l.7-2l.5-2.2l.3-2.4l0-2.4l-.2-2.4l-.5-2.4l-.7-2.3l-.9-2.1l-1.2-2l-1.2-1.8l-1.4-1.5l-1.4-1.2l-1.5-.9l-1.3-.6l-1.3-.4l-1.2-.1l-.9 .2l-.8 .4l-.4 .6l-.2 .7l.2 .8l.4 .9l.8 .8l1.1 .8l1.4 .7l1.6 .5l1.9 .3l2 .1l2.2-.1l2.2-.4l2.2-.6l2.3-.9l2.1-1.2l2-1.3l1.9-1.6l1.6-1.7l1.4-1.7l1.1-1.9l.9-1.8l.6-1.8l.3-1.7l.1-1.5l-.2-1.4l-.4-1l-.5-.9l-.7-.5l-.7-.2l-.7 .2l-.7 .4l-.6 .8l-.5 1l-.3 1.3l-.1 1.5l.2 1.7l.4 1.9l.6 1.9l1 1.9l1.2 2l1.5 1.8l1.7 1.7l1.8 1.6l2.1 1.3l2.1 1.1l2.2 .9l2.2 .6l2.1 .3l2 .1l1.9-.1l1.7-.4l1.4-.5l1.2-.7l.8-.7l.6-.8l.2-.8l-.1-.8l-.4-.6l-.7-.5l-.9-.2l-1.1-.1l-1.4 .2l-1.4 .5l-1.5 .8l-1.6 1.1l-1.5 1.4l-1.4 1.6l-1.3 1.8l-1.2 2.1l-.9 2.2l-.7 2.3l-.5 2.4l-.2 2.4l0 2.4l.3 2.2l.5 2.1l.7 1.9l.9 1.7l.9 1.4l1.1 1.1l1 .8l1.1 .5l.9 .2l.8 0l.7-.4l.4-.6l.2-.8l-.1-1l-.4-1.1l-.7-1.1l-1.1-1.1l-1.3-1.2l-1.5-1l-1.9-.8l-2-.7l-2.2-.5l-2.4-.3l-2.4 0l-2.4 .2l-2.4 .5l-2.3 .7l-2.1 .9l-2 1.2l-1.8 1.2l-1.5 1.4l-1.2 1.4l-.9 1.5l-.6 1.3l-.4 1.3l-.1 1.2l.2 .9l.4 .8l.6 .4l.7 .2l.8-.2l.9-.4l.8-.8l.8-1.1l.7-1.4l.5-1.6l.3-1.9l.1-2l-.1-2.2l-.4-2.2l-.6-2.2l-.9-2.3l-1.2-2.1l-1.3-2l-1.6-1.9l-1.7-1.6l-1.7-1.4l-1.9-1.1l-1.8-.9l-1.8-.6l-1.7-.3l-1.5-.1l-1.4 .2l-1 .4l-.9 .5l-.5 .7l-.2 .7l.2 .7l.4 .7l.8 .6l1 .5l1.3 .3l1.5 .1l1.7-.2l1.9-.4l1.9-.6l1.9-1l2-1.2l1.8-1.5l1.7-1.7l1.6-1.8l1.3-2.1l1.1-2.1l.9-2.2l.6-2.2l.3-2.1l.1-2l-.1-1.9l-.4-1.7l-.5-1.4l-.7-1.2l-.7-.8l-.8-.6l-.8-.2l-.8 .1l-.6 .4l-.5 .7l-.2 .9l-.1 1.1l.2 1.4l.5 1.4l.8 1.5l1.1 1.6l1.4 1.5l1.6 1.4l1.8 1.3l2.1 1.2l2.2 .9l2.3 .7l2.4 .5l2.4 .2l2.4 0l2.2-.3l2.1-.5l1.9-.7l1.7-.9l1.4-.9l1.1-1.1l.8-1l.5-1.1l.2-.9l0-.8Z';
const _inner =
    'M51.6 74.8l.2 0l.3-.1l.3-.3l.3-.5l.3-.6l.2-.8l.3-.9l.1-1l.1-1.1l0-1.3l-.2-1.2l-.2-1.3l-.4-1.4l-.4-1.3l-.6-1.2l-.7-1.2l-.7-1.1l-.8-1.1l-.8-.9l-.8-.7l-.9-.7l-.7-.5l-.8-.3l-.6-.3l-.6-.1l-.4 0l-.3 .1l-.1 .1l0 .2l.2 .2l.4 .2l.5 .2l.7 .2l.8 .1l.9 0l1.1-.1l1.1-.2l1.2-.2l1.2-.5l1.2-.5l1.2-.6l1.2-.8l1.1-.8l1-.9l.9-1l.8-1l.7-1l.6-.9l.4-1l.3-.9l.2-.8l.1-.6l0-.6l-.1-.4l-.1-.3l-.2-.1l-.1 .1l-.2 .2l-.1 .4l-.1 .6l0 .7l.1 .8l.2 .9l.3 1l.4 1l.5 1.1l.7 1.1l.8 1.1l.9 1l1 1l1 .9l1.1 .8l1.2 .7l1.1 .5l1.2 .5l1 .3l1.1 .2l.9 .2l.8 0l.7-.1l.5-.1l.4-.2l.2-.2l.1-.2l-.1-.1l-.3-.1l-.4-.1l-.6 .1l-.6 .1l-.8 .3l-.8 .4l-.9 .5l-1 .6l-.9 .8l-.9 .9l-.9 1l-.8 1.1l-.7 1.2l-.7 1.2l-.5 1.3l-.4 1.3l-.3 1.2l-.2 1.2l-.1 1.1l0 1.1l.1 .9l.2 .8l.2 .7l.3 .5l.2 .3l.2 .2l.2 0l.2-.2l0-.3l0-.4l-.2-.5l-.3-.6l-.4-.7l-.6-.8l-.7-.7l-.8-.8l-1-.7l-1.1-.7l-1.2-.6l-1.2-.6l-1.3-.4l-1.4-.4l-1.3-.2l-1.3-.1l-1.3 0l-1.2 0l-1.2 .2l-1 .3l-.8 .3l-.8 .3l-.6 .4l-.4 .3l-.3 .3l-.1 .3l0 .2l.2 .1l.3 0l.4-.2l.5-.3l.5-.4l.6-.6l.6-.7l.6-.8l.5-1l.5-1.1l.4-1.2l.4-1.3l.2-1.4l.2-1.3l0-1.4l0-1.4l-.2-1.3l-.3-1.3l-.3-1.1l-.5-1.1l-.4-.9l-.5-.8l-.5-.6l-.5-.5l-.4-.4l-.4-.2l-.3 0l-.2 0l0 .2l.1 .3l.2 .4l.4 .4l.5 .4l.7 .4l.8 .4l1 .4l1.1 .3l1.2 .3l1.3 .1l1.3 .1l1.3-.1l1.4-.1l1.4-.3l1.3-.4l1.2-.4l1.2-.6l1.1-.6l.9-.6l.8-.7l.7-.6l.5-.7l.4-.5l.2-.5l.1-.4l0-.3l-.1-.2l-.2 0l-.3 .1l-.3 .3l-.3 .5l-.3 .6l-.2 .8l-.3 .9l-.1 1l-.1 1.1l0 1.3l.2 1.2l.2 1.3l.4 1.4l.4 1.3l.6 1.2l.7 1.2l.7 1.1l.8 1.1l.8 .9l.8 .7l.9 .7l.7 .5l.8 .3l.6 .3l.6 .1l.4 0l.3-.1l.1-.1l0-.2l-.2-.2l-.4-.2l-.5-.2l-.7-.2l-.8-.1l-.9 0l-1.1 .1l-1.1 .2l-1.2 .2l-1.2 .5l-1.2 .5l-1.2 .6l-1.2 .8l-1.1 .8l-1 .9l-.9 1l-.8 1l-.7 1l-.6 .9l-.4 1l-.3 .9l-.2 .8l-.1 .6l0 .6l.1 .4l.1 .3l.2 .1l.1-.1l.2-.2l.1-.4l.1-.6l0-.7l-.1-.8l-.2-.9l-.3-1l-.4-1l-.5-1.1l-.7-1.1l-.8-1.1l-.9-1l-1-1l-1-.9l-1.1-.8l-1.2-.7l-1.1-.5l-1.2-.5l-1-.3l-1.1-.2l-.9-.2l-.8 0l-.7 .1l-.5 .1l-.4 .2l-.2 .2l-.1 .2l.1 .1l.3 .1l.4 .1l.6-.1l.6-.1l.8-.3l.8-.4l.9-.5l1-.6l.9-.8l.9-.9l.9-1l.8-1.1l.7-1.2l.7-1.2l.5-1.3l.4-1.3l.3-1.2l.2-1.2l.1-1.1l0-1.1l-.1-.9l-.2-.8l-.2-.7l-.3-.5l-.2-.3l-.2-.2l-.2 0l-.2 .2l0 .3l0 .4l.2 .5l.3 .6l.4 .7l.6 .8l.7 .7l.8 .8l1 .7l1.1 .7l1.2 .6l1.2 .6l1.3 .4l1.4 .4l1.3 .2l1.3 .1l1.3 0l1.2 0l1.2-.2l1-.3l.8-.3l.8-.3l.6-.4l.4-.3l.3-.3l.1-.3l0-.2l-.2-.1l-.3 0l-.4 .2l-.5 .3l-.5 .4l-.6 .6l-.6 .7l-.6 .8l-.5 1l-.5 1.1l-.4 1.2l-.4 1.3l-.2 1.4l-.2 1.3l0 1.4l0 1.4l.2 1.3l.3 1.3l.3 1.1l.5 1.1l.4 .9l.5 .8l.5 .6l.5 .5l.4 .4l.4 .2l.3 0l.2 0l0-.2l-.1-.3l-.2-.4l-.4-.4l-.5-.4l-.7-.4l-.8-.4l-1-.4l-1.1-.3l-1.2-.3l-1.3-.1l-1.3-.1l-1.3 .1l-1.4 .1l-1.4 .3l-1.3 .4l-1.2 .4l-1.2 .6l-1.1 .6l-.9 .6l-.8 .7l-.7 .6l-.5 .7l-.4 .5l-.2 .5l-.1 .4l0 .3Z';
