/// Timing and same-seal rules for one recorded take (Locked recorded sealing protocol, 2026-10-26).
library;

class TakeRules {
  TakeRules._();

  /// 3, 2, 1 after tap 1, then recording starts.
  static const countdownSeconds = 3;

  /// "15 seconds left".
  static const warnAt = Duration(minutes: 1, seconds: 45);

  /// The take is over at 2:00 and can't be sealed.
  static const maxLength = Duration(minutes: 2);
}

enum RecordingPhase { normal, warning, over }

RecordingPhase recordingPhase(Duration elapsed) {
  if (elapsed >= TakeRules.maxLength) return RecordingPhase.over;
  if (elapsed >= TakeRules.warnAt) return RecordingPhase.warning;
  return RecordingPhase.normal;
}

/// Seconds left, never negative, rounded up so the display reaches 0 only at the end.
int secondsLeft(Duration elapsed) {
  final left = TakeRules.maxLength - elapsed;
  if (left <= Duration.zero) return 0;
  return (left.inMilliseconds / 1000).ceil();
}

/// `1:05`.
String clock(Duration d) {
  final s = d.inSeconds.clamp(0, 5999);
  return '${s ~/ 60}:${(s % 60).toString().padLeft(2, '0')}';
}

/// Tap 2 must be the seal tap 1 read.
bool sameSeal(String serial1, String serial2) => serial1 == serial2;
