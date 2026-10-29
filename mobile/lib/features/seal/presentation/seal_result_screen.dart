import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app_providers.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_typography.dart';
import '../../../routing/route_names.dart';
import '../../../shared/seal/seal_badge.dart';
import '../../auth/presentation/widgets/gradient_button.dart';
import '../../mfa/data/mfa_models.dart';
import '../../mfa/presentation/step_up_sheet.dart';
import '../data/pending_seal.dart';
import '../data/seal_sync.dart';
import '../data/seal_tap.dart';
import '../seal_providers.dart';
import 'seal_take_screen.dart';

/// Finishing one queued seal: Confirm it's you, then the server records it.
///
/// The creator sees "Sealed" (still) straight away with a quiet "Syncing" while it's on the phone, and the
/// moving Verified seal only once the server has accepted it. (Collectors never get an early green: this
/// screen is only reachable from a creator's own take.)
class SealResultScreen extends ConsumerStatefulWidget {
  const SealResultScreen({super.key, required this.sealId});

  /// The queue entry's id (not the server's seal id).
  final String sealId;

  @override
  ConsumerState<SealResultScreen> createState() => _SealResultScreenState();
}

class _SealResultScreenState extends ConsumerState<SealResultScreen> {
  bool _working = false;
  CommitResult? _last;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _finish());
  }

  PendingSeal? _seal() {
    final list = ref.read(pendingSealsProvider).valueOrNull ?? const [];
    for (final s in list) {
      if (s.id == widget.sealId) return s;
    }
    return null;
  }

  Future<String?> _confirm(String serial) async {
    final MfaStatus status = await ref.read(mfaApiProvider).status();
    if (!mounted) return null;
    return confirmItsYou(
      context,
      action: StepUpAction.seal,
      targetId: serial,
      status: status,
      purpose: 'Seal your piece with the seal ending in ${serialSuffix(serial)}. This is permanent.',
    );
  }

  Future<void> _finish() async {
    await ref.read(pendingSealsProvider.future);
    final seal = _seal();
    if (seal == null || seal.state != PendingSealState.waiting || _working) return;
    setState(() => _working = true);
    final result = await finishSeal(ref.read(sealApiProvider), seal, _confirm);
    final updated = result.updated;
    if (updated != null) await ref.read(pendingSealsProvider.notifier).replace(updated);
    if (!mounted) return;
    setState(() {
      _working = false;
      _last = result;
    });
  }

  Future<void> _recordAgain(PendingSeal seal) async {
    // These taps can't be used; the seal is on the piece now.
    await ref.read(pendingSealsProvider.notifier).dismiss(seal);
    if (mounted) context.pushReplacement(RouteNames.sealTake, extra: const TakeArgs(sealAlreadyOn: true));
  }

  @override
  Widget build(BuildContext context) {
    final seals = ref.watch(pendingSealsProvider);
    final seal = seals.valueOrNull?.where((s) => s.id == widget.sealId).firstOrNull;
    return Scaffold(
      appBar: AppBar(title: const Text('Your seal')),
      body: SafeArea(
        child: seal == null
            ? Center(
                child: seals.isLoading
                    ? const CircularProgressIndicator()
                    : Text('This seal is no longer on this phone.', style: AppTypography.bodyLarge),
              )
            : ListView(padding: const EdgeInsets.all(24), children: _body(seal)),
      ),
    );
  }

  List<Widget> _body(PendingSeal seal) {
    final result = _last;
    final serverSealed = seal.state == PendingSealState.sealed;
    final refused = seal.state == PendingSealState.refused;
    final redo = result?.outcome == CommitOutcome.redo;

    Widget badge(SealState state) => Center(child: SealBadge(state: state, size: 160));
    Text title(String s) => Text(s, style: AppTypography.headlineSmall, textAlign: TextAlign.center);
    Widget note(String s, {Color color = AppColors.textSecondary}) => Semantics(
          liveRegion: true,
          child: Text(s, style: AppTypography.bodyMedium.copyWith(color: color), textAlign: TextAlign.center),
        );
    final home = TextButton(onPressed: () => context.go(RouteNames.home), child: const Text('Done'));

    if (serverSealed) {
      return [
        badge(SealState.verified),
        const SizedBox(height: 20),
        title('Sealed.'),
        const SizedBox(height: 8),
        note('Your piece is AM Sealed. Keep the app installed: the video uploads from this phone.'),
        const SizedBox(height: 24),
        GradientButton(text: 'Done', onPressed: () => context.go(RouteNames.home)),
      ];
    }
    if (refused) {
      return [
        title('This seal can’t be finished'),
        const SizedBox(height: 8),
        note(result?.message ?? 'We couldn’t record this seal.', color: AppColors.warning),
        const SizedBox(height: 24),
        GradientButton(
          text: 'OK',
          onPressed: () async {
            await ref.read(pendingSealsProvider.notifier).dismiss(seal);
            if (mounted) context.go(RouteNames.home);
          },
        ),
      ];
    }
    if (redo) {
      return [
        title('Record it again'),
        const SizedBox(height: 8),
        note(result?.message ?? '', color: AppColors.warning),
        const SizedBox(height: 24),
        GradientButton(text: 'Record it again', onPressed: () => _recordAgain(seal)),
        home,
      ];
    }
    // Waiting: the optimistic, creator-only state.
    return [
      badge(SealState.sealed),
      const SizedBox(height: 20),
      title('Sealed'),
      const SizedBox(height: 4),
      note(_working ? 'Syncing…' : 'Syncing', color: AppColors.textTertiary),
      if (result?.message != null) ...[
        const SizedBox(height: 16),
        note(result!.message!, color: result.outcome == CommitOutcome.keepWaiting ? AppColors.textSecondary : AppColors.warning),
      ],
      const SizedBox(height: 24),
      if (!_working)
        GradientButton(
          text: result?.outcome == CommitOutcome.keepWaiting ? 'Try now' : 'Confirm it’s you',
          onPressed: _finish,
        )
      else
        const Center(child: CircularProgressIndicator()),
      home,
    ];
  }
}
