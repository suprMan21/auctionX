import '../../../core/network/api_client.dart';
import '../../mfa/mfa_copy.dart';
import 'pending_seal.dart';
import 'seal_api.dart';

enum CommitOutcome {
  /// The server accepted the seal.
  sealed,

  /// Still on the phone (no signal, server busy). Try again later; nothing is lost.
  keepWaiting,

  /// The person closed Confirm it's you, or it failed. Try again.
  confirmAgain,

  /// These taps can't be used (read during the video, already used). Record a new take: the seal is on.
  redo,

  /// The server refused the seal for good.
  refused,
}

class CommitResult {
  const CommitResult(this.outcome, {this.message, this.reason, this.updated});
  final CommitOutcome outcome;

  /// Shown to the creator; null for [CommitOutcome.sealed].
  final String? message;

  /// The server's machine reason, kept on refused seals.
  final String? reason;

  /// The queue entry after this attempt (state, seal id, dropped session).
  final PendingSeal? updated;
}

const keepWaitingCopy = 'Saved on this phone. We’ll finish the seal when you’re back online.';

const _redoCopy = {
  'seal_gap': 'Something read the seal during the video, so this take can’t be used. '
      'Record it again: tap the seal to start and tap it again to finish.',
  'replay_detected': 'These taps were already used. Record it again with two new taps.',
  'invalid_signature': 'We couldn’t verify the seal from these taps. Record it again with two new taps.',
};

const _refusedCopy = {
  'already_claimed': 'This seal is already claimed, so it can’t be sealed again.',
  'not_sealable': 'This seal can’t be sealed in the app. Contact us at hello@authentic-materials.com.',
  'creator_only': 'Only creator accounts can seal.',
  'not_found': 'This isn’t an Authentic Materials seal we can find.',
};

/// What a failed commit means for the creator. Branches on the server's closed-set reason, never on text.
CommitResult classifyCommitError(Object error, PendingSeal seal) {
  if (error is! ApiException) return const CommitResult(CommitOutcome.keepWaiting, message: keepWaitingCopy);
  final reason = error.reason ?? (error.status == 404 ? 'not_found' : null);
  if (error.isNetwork || (error.status ?? 0) >= 500 || error.status == 429) {
    return const CommitResult(CommitOutcome.keepWaiting, message: keepWaitingCopy);
  }
  if (reason == 'tap_session_invalid') {
    // The start time ran out; the taps are still good. Send again without it.
    return CommitResult(
      CommitOutcome.confirmAgain,
      message: 'Confirm it’s you once more to finish the seal.',
      updated: seal.withoutSession(),
    );
  }
  final redo = _redoCopy[reason];
  if (redo != null) return CommitResult(CommitOutcome.redo, message: redo, reason: reason);
  final refused = _refusedCopy[reason];
  if (refused != null) {
    return CommitResult(
      CommitOutcome.refused,
      message: refused,
      reason: reason,
      updated: seal.copyWith(state: PendingSealState.refused, refusedReason: reason),
    );
  }
  // Step-up refusals (a new method still waiting, recovery freeze, …) and anything else the person can fix.
  return CommitResult(CommitOutcome.confirmAgain, message: mfaErrorCopy(error));
}

/// Asks for a `seal` grant bound to [serial]. Null when the person closed the sheet.
typedef ConfirmSeal = Future<String?> Function(String serial);

/// One attempt to finish a queued seal: Confirm it's you, then commit.
Future<CommitResult> finishSeal(SealApi api, PendingSeal seal, ConfirmSeal confirm) async {
  final String? token;
  try {
    token = await confirm(seal.serial);
  } catch (e) {
    // Usually no signal while loading the second-step status.
    return classifyCommitError(e, seal);
  }
  if (token == null) {
    return const CommitResult(CommitOutcome.confirmAgain, message: 'The seal isn’t finished yet. Confirm it’s you to finish.');
  }
  try {
    final done = await api.commit(seal, token);
    return CommitResult(
      CommitOutcome.sealed,
      updated: seal.copyWith(state: PendingSealState.sealed, sealId: done.sealId),
    );
  } catch (e) {
    return classifyCommitError(e, seal);
  }
}
