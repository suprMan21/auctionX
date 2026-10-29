import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:video_player/video_player.dart';

import '../../../app_providers.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_typography.dart';
import '../../../routing/route_names.dart';
import '../../auth/data/auth_service.dart';
import '../../auth/presentation/widgets/gradient_button.dart';
import '../data/pending_seal.dart';
import '../data/seal_reader.dart';
import '../data/seal_tap.dart';
import '../data/seal_video_store.dart';
import '../data/take_recorder.dart';
import '../data/take_rules.dart';
import '../seal_copy.dart';
import '../seal_providers.dart';

class TakeArgs {
  const TakeArgs({this.practice = false, this.sealAlreadyOn = false});

  /// No seal is read and nothing is kept.
  final bool practice;

  /// A redo: the seal went on in an earlier take. Recorded as "seal applied before recording".
  final bool sealAlreadyOn;
}

/// The camera, overridable in tests.
final takeRecorderFactoryProvider = Provider<TakeRecorder Function()>((_) => CameraTakeRecorder.new);

/// Clock, overridable in tests.
final takeClockProvider = Provider<DateTime Function()>((_) => DateTime.now);

enum TakePhase { starting, cameraProblem, tap1, countdown, recording, finishing, review, timeUp }

/// One take: tap 1 → 3, 2, 1 → record (apply the seal) → tap 2 stops → review → Seal it / Redo.
class SealTakeScreen extends ConsumerStatefulWidget {
  const SealTakeScreen({super.key, this.args = const TakeArgs()});

  final TakeArgs args;

  @override
  ConsumerState<SealTakeScreen> createState() => _SealTakeScreenState();
}

class _SealTakeScreenState extends ConsumerState<SealTakeScreen> with WidgetsBindingObserver {
  late final TakeRecorder _recorder = ref.read(takeRecorderFactoryProvider)();
  late final SealReader _reader = ref.read(sealReaderProvider);
  TakePhase _phase = TakePhase.starting;
  String? _note;
  bool _busy = false;

  SealTap? _tap1;
  SealTap? _tap2;
  String? _sessionId;
  int _countdown = TakeRules.countdownSeconds;
  DateTime? _recordingStartedAt;
  Duration _elapsed = Duration.zero;
  Timer? _ticker;
  String? _videoPath;
  VideoPlayerController? _player;

  bool get _practice => widget.args.practice;
  DateTime _now() => ref.read(takeClockProvider)();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _reader; // read the provider now: dispose can't use ref
    _startCamera();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _ticker?.cancel();
    _player?.dispose();
    _reader.cancel();
    _recorder.dispose();
    // Never leave a take that wasn't sealed on the phone.
    if (_phase != TakePhase.finishing) SealVideoStore.discard(_videoPath);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Only "paused" (the app left the screen). The iPhone NFC sheet makes the app "inactive"; that's fine.
    if (state == AppLifecycleState.paused && (_phase == TakePhase.recording || _phase == TakePhase.countdown)) {
      _voidTake('The take stopped because the app left the screen.');
    }
  }

  Future<void> _startCamera() async {
    try {
      await _recorder.init();
      if (!mounted) return;
      setState(() => _phase = TakePhase.tap1);
    } on RecorderException catch (e) {
      if (!mounted) return;
      setState(() {
        _phase = TakePhase.cameraProblem;
        _note = e.failure == RecorderFailure.denied
            ? 'Allow the camera and microphone for Authentic Materials in Settings, then come back.'
            : 'The camera couldn’t start. Close other apps using it and try again.';
      });
    }
  }

  // ── Tap 1 ──

  Future<void> _readTap1() async {
    setState(() {
      _busy = true;
      _note = null;
    });
    try {
      final SealTap tap;
      if (_practice) {
        tap = SealTap(url: 'practice', serial: 'PRACTICE00000000', readAt: _now());
      } else {
        final url = await ref
            .read(sealReaderProvider)
            .readUrl(prompt: widget.args.sealAlreadyOn ? tap1PromptRedo : tap1Prompt);
        tap = parseSealTap(url, _now());
        _startSession(tap.serial);
      }
      if (!mounted) return;
      _tap1 = tap;
      await _runCountdown();
    } catch (e) {
      if (mounted) setState(() => _note = readFailureCopy(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Optional server time for the record. Never waits on it and never fails the take.
  void _startSession(String serial) {
    ref
        .read(sealApiProvider)
        .startSession(serial)
        .timeout(const Duration(seconds: 5))
        .then<void>((s) => _sessionId = s.id, onError: (Object _) {});
  }

  Future<void> _runCountdown() async {
    setState(() {
      _phase = TakePhase.countdown;
      _countdown = TakeRules.countdownSeconds;
    });
    for (var i = TakeRules.countdownSeconds; i > 0; i--) {
      if (!mounted || _phase != TakePhase.countdown) return;
      setState(() => _countdown = i);
      await Future<void>.delayed(const Duration(seconds: 1));
    }
    if (!mounted || _phase != TakePhase.countdown) return;
    try {
      await _recorder.start();
    } on RecorderException {
      _voidTake('The recording couldn’t start. Try again.');
      return;
    }
    _recordingStartedAt = _now();
    setState(() {
      _phase = TakePhase.recording;
      _elapsed = Duration.zero;
    });
    _ticker = Timer.periodic(const Duration(milliseconds: 250), (_) => _tick());
  }

  void _tick() {
    final start = _recordingStartedAt;
    if (!mounted || start == null || _phase != TakePhase.recording) return;
    final elapsed = _now().difference(start);
    if (recordingPhase(elapsed) == RecordingPhase.over) {
      _timeUp();
      return;
    }
    setState(() => _elapsed = elapsed);
  }

  // ── Tap 2 ──

  Future<void> _readTap2() async {
    final tap1 = _tap1;
    if (tap1 == null) return;
    setState(() {
      _busy = true;
      _note = null;
    });
    try {
      final SealTap tap;
      if (_practice) {
        tap = SealTap(url: 'practice', serial: tap1.serial, readAt: _now());
      } else {
        final url = await _reader.readUrl(prompt: tap2Prompt);
        tap = parseSealTap(url, _now());
      }
      if (!mounted || _phase != TakePhase.recording) return;
      final start = _recordingStartedAt!;
      if (recordingPhase(tap.readAt.difference(start)) == RecordingPhase.over) {
        await _timeUp();
        return;
      }
      if (!sameSeal(tap1.serial, tap.serial)) {
        setState(() => _note = 'That’s a different seal. Tap the seal you started with '
            '(ends in ${serialSuffix(tap1.serial)}).');
        return;
      }
      _tap2 = tap;
      await _stopAndReview();
    } catch (e) {
      if (mounted && _phase == TakePhase.recording) setState(() => _note = readFailureCopy(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _stopAndReview() async {
    _ticker?.cancel();
    final String path;
    try {
      path = await _recorder.stop();
    } on RecorderException {
      _voidTake('The recording couldn’t be saved. Record it again.');
      return;
    }
    _videoPath = path;
    final player = VideoPlayerController.file(File(path));
    _player = player;
    setState(() => _phase = TakePhase.review);
    try {
      await player.initialize();
      await player.setLooping(true);
      if (mounted) setState(() {});
    } catch (_) {
      // Review without playback still works; the file is there.
    }
  }

  Future<void> _timeUp() async {
    _reader.cancel();
    _ticker?.cancel();
    try {
      final path = await _recorder.stop();
      unawaited(SealVideoStore.discard(path).catchError((Object _) {}));
    } catch (_) {}
    if (!mounted) return;
    setState(() {
      _phase = TakePhase.timeUp;
      _note = null;
      _tap1 = null;
    });
  }

  void _voidTake(String message) {
    _reader.cancel();
    _ticker?.cancel();
    if (_phase == TakePhase.recording) {
      _recorder.stop().then<void>(SealVideoStore.discard, onError: (Object _) {});
    }
    if (!mounted) return;
    setState(() {
      _phase = TakePhase.tap1;
      _tap1 = null;
      _tap2 = null;
      _note = message;
    });
  }

  // ── Review ──

  void _redo({required bool sealOn}) {
    context.pushReplacement(
      RouteNames.sealTake,
      extra: TakeArgs(practice: _practice, sealAlreadyOn: _practice ? false : sealOn),
    );
  }

  Future<void> _sealIt() async {
    final tap1 = _tap1;
    final tap2 = _tap2;
    final path = _videoPath;
    final auth = ref.read(authControllerProvider);
    if (tap1 == null || tap2 == null || path == null || auth is! SignedIn) return;
    setState(() {
      _busy = true;
      _phase = TakePhase.finishing;
    });
    await _player?.pause();
    try {
      final id = _takeId();
      final kept = await ref.read(sealVideoStoreProvider).keep(path, id);
      final seal = PendingSeal(
        id: id,
        ownerId: auth.user.id,
        tap1: tap1,
        tap2: tap2,
        videoPath: kept.path,
        videoSha256: await sha256OfFile(kept),
        createdAt: _now(),
        sessionId: _sessionId,
        appliedBeforeRecording: widget.args.sealAlreadyOn,
      );
      await ref.read(pendingSealsProvider.notifier).add(seal);
      _videoPath = null;
      if (mounted) context.pushReplacement(RouteNames.sealResult, extra: seal.id);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _phase = TakePhase.review;
        _busy = false;
        _note = 'The video couldn’t be saved on this phone. Free up some space and try again.';
      });
    }
  }

  static String _takeId() {
    final r = Random.secure();
    return List.generate(16, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
  }

  Future<bool> _confirmLeave() async {
    if (_phase != TakePhase.recording && _phase != TakePhase.countdown && _phase != TakePhase.review) return true;
    final leave = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Stop this take?'),
        content: const Text('The video won’t be kept. If the seal is already on, you can record it again.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Keep going')),
          TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Stop')),
        ],
      ),
    );
    return leave ?? false;
  }

  // ── UI ──

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        if (await _confirmLeave() && context.mounted) context.pop();
      },
      child: Scaffold(
        backgroundColor: AppColors.darkest,
        appBar: AppBar(
          title: Text(_practice ? 'Practice run' : 'Seal a piece'),
          backgroundColor: AppColors.darkest,
        ),
        body: SafeArea(child: _phase == TakePhase.review || _phase == TakePhase.finishing ? _review() : _camera()),
      ),
    );
  }

  Widget _camera() {
    final recording = _phase == TakePhase.recording;
    final phase = recordingPhase(_elapsed);
    return Stack(
      fit: StackFit.expand,
      children: [
        if (_phase != TakePhase.cameraProblem) ClipRect(child: _recorder.preview()),
        if (recording)
          Positioned(
            top: 12,
            left: 0,
            right: 0,
            child: Center(child: _RecordingBadge(elapsed: _elapsed, warning: phase == RecordingPhase.warning)),
          ),
        if (_phase == TakePhase.countdown)
          Center(
            child: Semantics(
              liveRegion: true,
              child: Text('$_countdown', style: AppTypography.headlineLarge.copyWith(fontSize: 120)),
            ),
          ),
        if (_practice)
          Positioned(
            top: recording ? 56 : 12,
            left: 0,
            right: 0,
            child: Center(
              child: Text('PRACTICE · nothing is kept',
                  style: AppTypography.labelSmall.copyWith(color: AppColors.warning)),
            ),
          ),
        Positioned(left: 0, right: 0, bottom: 0, child: _controls()),
      ],
    );
  }

  Widget _controls() {
    final children = <Widget>[];
    void text(String s, {Color? color, TextStyle? style}) => children.add(Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Text(s,
              textAlign: TextAlign.center,
              style: (style ?? AppTypography.bodyLarge).copyWith(color: color ?? AppColors.textPrimary)),
        ));

    switch (_phase) {
      case TakePhase.starting:
        text('Starting the camera…');
      case TakePhase.cameraProblem:
        text(_note ?? '');
        children.add(OutlinedButton(onPressed: () => context.pop(), child: const Text('Back')));
      case TakePhase.tap1:
        text(widget.args.sealAlreadyOn
            ? 'The seal is already on. Frame yourself and the piece, then tap the seal to start.'
            : 'Frame yourself and the piece. Tap the loose seal to start; recording begins after 3, 2, 1.');
        if (_note != null) text(_note!, color: AppColors.warning, style: AppTypography.bodyMedium);
        children.add(GradientButton(
          text: _practice ? 'Pretend to tap the seal' : 'Tap the seal to start',
          isLoading: _busy,
          onPressed: _busy ? null : _readTap1,
        ));
        if (_recorder.canFlip) {
          children.add(TextButton(
            onPressed: _busy ? null : () => _recorder.flip().then((_) => setState(() {})),
            child: const Text('Switch camera'),
          ));
        }
      case TakePhase.countdown:
        text('Get ready…');
      case TakePhase.recording:
        final warning = recordingPhase(_elapsed) == RecordingPhase.warning;
        text(widget.args.sealAlreadyOn
            ? 'Tell your story. Tap the seal again to finish.'
            : 'Tell your story and apply the seal on camera: on the piece, across any seam, pressed down firmly. '
                'Then tap it to finish.');
        if (warning) text('${secondsLeft(_elapsed)} seconds left', color: AppColors.warning);
        if (_note != null) text(_note!, color: AppColors.warning, style: AppTypography.bodyMedium);
        children.add(GradientButton(
          text: _practice ? 'Pretend to tap the seal' : 'Tap the seal to finish',
          isLoading: _busy,
          onPressed: _busy ? null : _readTap2,
        ));
      case TakePhase.timeUp:
        text('Time’s up. A take is 2 minutes at most, so this one can’t be sealed.');
        text('Is the seal already on the piece?', style: AppTypography.titleMedium);
        children.add(GradientButton(text: 'Yes, it’s on', onPressed: () => _redo(sealOn: true)));
        children.add(const SizedBox(height: 8));
        children.add(OutlinedButton(onPressed: () => _redo(sealOn: false), child: const Text('No, not yet')));
      case TakePhase.review || TakePhase.finishing:
        break;
    }
    return Container(
      padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0x000A0A0F), Color(0xE60A0A0F)],
        ),
      ),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
    );
  }

  Widget _review() {
    final player = _player;
    final ready = player != null && player.value.isInitialized;
    final finishing = _phase == TakePhase.finishing;
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Semantics(header: true, child: Text('Watch your take', style: AppTypography.headlineSmall)),
        const SizedBox(height: 8),
        Text(
          _practice
              ? 'This was a practice run. Nothing is kept.'
              : 'If you’re happy with it, seal it. This is permanent: everyone who taps this seal sees this video.',
          style: AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary),
        ),
        const SizedBox(height: 16),
        AspectRatio(
          aspectRatio: ready ? player.value.aspectRatio : 9 / 16,
          child: ready
              ? GestureDetector(
                  onTap: () => setState(() => player.value.isPlaying ? player.pause() : player.play()),
                  child: Stack(alignment: Alignment.center, children: [
                    VideoPlayer(player),
                    if (!player.value.isPlaying)
                      const Icon(Icons.play_circle_fill, size: 72, semanticLabel: 'Play'),
                  ]),
                )
              : const ColoredBox(color: AppColors.surface),
        ),
        const SizedBox(height: 20),
        if (_note != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(_note!, style: AppTypography.bodyMedium.copyWith(color: AppColors.warning)),
          ),
        if (_practice) ...[
          GradientButton(
            text: 'I’m ready',
            onPressed: () => context.pushReplacement(RouteNames.sealTake, extra: const TakeArgs()),
          ),
          const SizedBox(height: 8),
          OutlinedButton(onPressed: () => _redo(sealOn: false), child: const Text('Practice again')),
        ] else ...[
          GradientButton(text: 'Seal it', isLoading: finishing, onPressed: finishing ? null : _sealIt),
          const SizedBox(height: 8),
          OutlinedButton(
            onPressed: finishing ? null : () => _redo(sealOn: true),
            child: const Text('Redo'),
          ),
          const SizedBox(height: 8),
          Text(
            'Redo records a new take. The seal is already on, so the record says it was applied before recording.',
            style: AppTypography.bodySmall.copyWith(color: AppColors.textTertiary),
          ),
        ],
      ],
    );
  }
}

class _RecordingBadge extends StatelessWidget {
  const _RecordingBadge({required this.elapsed, required this.warning});
  final Duration elapsed;
  final bool warning;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Recording, ${clock(elapsed)} of ${clock(TakeRules.maxLength)}',
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: warning ? AppColors.warning : AppColors.error,
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text('● REC ${clock(elapsed)} / ${clock(TakeRules.maxLength)}',
            style: AppTypography.labelLarge.copyWith(color: AppColors.darkest)),
      ),
    );
  }
}
