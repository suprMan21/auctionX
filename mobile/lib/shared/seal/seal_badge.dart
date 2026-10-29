import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/widgets.dart';

import 'seal_geometry.dart';
import 'seal_spec.dart';
import 'svg_path.dart';

/// DR-22 states, same as the website's SealBadge.
enum SealState {
  /// Animated. Only right after a tap the server accepted.
  verified,

  /// Still and muted: a remembered tap, a list of seals, a picture. Never says Verified.
  sealed,
}

/// True when the person asked for less motion (Android "Remove animations" or iOS Reduce Motion).
bool sealReduceMotion(BuildContext context) =>
    MediaQuery.maybeDisableAnimationsOf(context) == true ||
    (View.maybeOf(context)?.platformDispatcher.accessibilityFeatures.reduceMotion ?? false);

/// The genuine AM seal, drawn from the same geometry and seal spec as the website and the server.
///
/// Verified (Shimmer): the text ring turns every 12 s with a soft 3 s glow, the pattern rings turn
/// (outer every 48 s one way, inner every 30 s the other), their lines are holographic, a faint
/// rainbow sheen sits on the badge and a glint sweeps across 1 s after the seal appears, then every 30 s.
/// Sealed: white still rings, no sheen, no glow, muted colours. Reduce Motion: nothing moves.
///
/// Layers: the badge body, the fixed centre and the text ring each sit in their own
/// RepaintBoundary. The text ring and the glow move by transform / opacity only (no repaint);
/// only the body repaints while Verified is moving, and only while it is on screen.
class SealBadge extends StatefulWidget {
  const SealBadge({super.key, this.code, this.spec, this.state = SealState.verified, this.size = 88, this.label});

  /// Seal code in display form (XXXX-XXXX). Never a chip serial or UID. Null draws the generic seal.
  final String? code;

  /// This seal's stored spec. Without one the badge draws no pattern (older data, generic seal).
  final SealSpec? spec;
  final SealState state;

  /// Width and height in logical pixels.
  final double size;

  /// Accessible name. Omit for a decorative seal (hidden from screen readers).
  final String? label;

  @override
  State<SealBadge> createState() => _SealBadgeState();
}

class _SealBadgeState extends State<SealBadge> with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  /// Seconds since this seal started moving.
  late final AnimationController _clock;
  bool _moving = false;

  @override
  void initState() {
    super.initState();
    _clock = AnimationController.unbounded(vsync: this);
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _syncClock(_shouldMove());
  }

  @override
  void didUpdateWidget(SealBadge old) {
    super.didUpdateWidget(old);
    _syncClock(_shouldMove());
  }

  @override
  void didChangeAccessibilityFeatures() {
    // iOS Reduce Motion does not change MediaQuery, so listen for it here.
    if (!mounted) return;
    setState(() => _syncClock(_shouldMove()));
  }

  bool _shouldMove() => widget.state == SealState.verified && !sealReduceMotion(context);

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _clock.dispose();
    super.dispose();
  }

  void _syncClock(bool shouldMove) {
    if (shouldMove == _moving) return;
    _moving = shouldMove;
    if (shouldMove) {
      // From zero, so the first glint comes 1 s after the seal appears.
      _clock.animateWith(_Forever());
    } else {
      _clock.stop();
      _clock.value = 0;
    }
  }

  @override
  Widget build(BuildContext context) {
    final verified = widget.state == SealState.verified;
    final moving = _moving;

    final code = widget.code;
    assert(code == null || isSealCode(code), 'SealBadge: code must be a seal code (XXXX-XXXX, Crockford base32)');
    final shownCode = isSealCode(code) ? code : null;
    final spec = widget.spec;
    final shimmer = verified && spec != null;
    final clock = moving ? _clock : null;

    Widget ring = const RepaintBoundary(child: CustomPaint(painter: _TextRingPainter()));
    if (clock != null) ring = RotationTransition(turns: clock.drive(_Fn((t) => (t / 12) % 1)), child: ring);

    Widget badge = Stack(
      clipBehavior: Clip.none,
      fit: StackFit.expand,
      children: [
        if (verified) ...[
          // drop-shadow(0 0 10px brand / .55), pulsing to 18px / .85 every 3 s.
          RepaintBoundary(
            child: CustomPaint(painter: _GlowPainter(sigmaPx: 5, opacity: .55, size: widget.size)),
          ),
          if (clock != null)
            FadeTransition(
              opacity: clock.drive(_Fn(_pulse)),
              child: RepaintBoundary(
                child: CustomPaint(painter: _GlowPainter(sigmaPx: 9, opacity: .85, size: widget.size)),
              ),
            ),
        ],
        RepaintBoundary(
          child: CustomPaint(
            painter: _BodyPainter(spec: spec, shimmer: shimmer, clock: clock),
          ),
        ),
        RepaintBoundary(child: CustomPaint(painter: _CentrePainter(shownCode))),
        ring,
      ],
    );

    if (!verified) badge = ColorFiltered(colorFilter: _mutedFilter, child: badge);

    final sized = SizedBox.square(dimension: widget.size, child: badge);
    final label = widget.label;
    return label == null
        ? ExcludeSemantics(child: sized)
        : Semantics(
            label: label,
            image: true,
            child: ExcludeSemantics(child: sized),
          );
  }
}

/// Glow pulse: 0 → 1 → 0 over 3 s, eased each way (CSS `ease-in-out` keyframes at 0 / 50 / 100 %).
double _pulse(double t) {
  final p = (t % 3) / 3;
  return Curves.easeInOut.transform(p < .5 ? p * 2 : (1 - p) * 2);
}

class _Fn extends Animatable<double> {
  _Fn(this.f);
  final double Function(double) f;
  @override
  double transform(double t) => f(t);
}

/// Time in seconds, forever.
class _Forever extends Simulation {
  @override
  double x(double time) => time;
  @override
  double dx(double time) => 1;
  @override
  bool isDone(double time) => false;
}

/// The website's Sealed look, CSS `saturate(.6) brightness(.82)`.
final ColorFilter _mutedFilter = () {
  const s = .6, b = .82;
  return const ColorFilter.matrix([
    (.213 + .787 * s) * b,
    (.715 - .715 * s) * b,
    (.072 - .072 * s) * b,
    0,
    0,
    (.213 - .213 * s) * b,
    (.715 + .285 * s) * b,
    (.072 - .072 * s) * b,
    0,
    0,
    (.213 - .213 * s) * b,
    (.715 - .715 * s) * b,
    (.072 + .928 * s) * b,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
  ]);
}();

// ---- Shared drawing parts -------------------------------------------------------------------

final ParsedSvgPath _scallop = parseSvgPath(SealGeometry.scallop);
final Path _amMark = parseSvgPath(SealGeometry.amMark).path..fillType = PathFillType.evenOdd;
const Offset _centre = Offset(60, 60);
const Rect _box = Rect.fromLTWH(0, 0, 120, 120);
const Color _white = Color(0xFFFFFFFF);
const Color _brand = Color(0xFF7C3AED);

/// Holographic colours (Shimmer, Boss 2026-10-28): cyan, violet, pink, gold, mint.
const List<Color> _holo = [
  Color(0xFF7DF9FF),
  Color(0xFFB388FF),
  Color(0xFFFF80BF),
  Color(0xFFFFE57F),
  Color(0xFF80FFB0),
  Color(0xFF7DF9FF),
];
const List<double> _holoStops = [0, .2, .4, .6, .8, 1];

/// The holographic gradient ((20,20) → (100,100), reflected), turned [degrees] about the centre.
/// Opacity is baked into the colours so every renderer applies it the same way.
ui.Shader _holoShader(double degrees, double opacity) {
  final a = degrees * math.pi / 180;
  final m = Matrix4.identity()
    ..translateByDouble(60, 60, 0, 1)
    ..rotateZ(a)
    ..translateByDouble(-60, -60, 0, 1);
  return ui.Gradient.linear(
    const Offset(20, 20),
    const Offset(100, 100),
    [for (final c in _holo) c.withValues(alpha: opacity)],
    _holoStops,
    TileMode.mirror,
    Float64List.fromList(m.storage),
  );
}

void _scaleToBox(Canvas canvas, Size size) =>
    canvas.scale(size.width / SealGeometry.viewBox, size.height / SealGeometry.viewBox);

void _rotateAboutCentre(Canvas canvas, double degrees) {
  canvas.translate(60, 60);
  canvas.rotate(degrees * math.pi / 180);
  canvas.translate(-60, -60);
}

/// Glint position (x of the band centre, before its 25° tilt), or null while it is off the badge.
/// Crosses from −50 to 170 in 3 s, starting 1 s after the seal appears, then every 30 s.
double? _sweepX(double t) {
  final p = t % 30;
  if (p <= 1 || p >= 4) return null;
  return -50 + 220 * (p - 1) / 3;
}

/// Keeps only the sweep band of what was drawn since the last saveLayer.
void _applySweepMask(Canvas canvas, double x) {
  canvas.save();
  _rotateAboutCentre(canvas, 25);
  final band = ui.Gradient.linear(
    Offset(x - 120, 0),
    Offset(x + 120, 0),
    const [Color(0x00FFFFFF), Color(0x00FFFFFF), _white, Color(0x00FFFFFF), Color(0x00FFFFFF)],
    const [0, .42, .5, .58, 1],
  );
  canvas.drawRect(
    const Rect.fromLTRB(-200, -200, 320, 320),
    Paint()
      ..shader = band
      ..blendMode = BlendMode.dstIn,
  );
  canvas.restore();
}

// ---- Painters ------------------------------------------------------------------------------

class _GlowPainter extends CustomPainter {
  const _GlowPainter({required this.sigmaPx, required this.opacity, required this.size});
  final double sigmaPx;
  final double opacity;
  final double size;

  @override
  void paint(Canvas canvas, Size s) {
    _scaleToBox(canvas, s);
    canvas.drawPath(
      _scallop.path,
      Paint()
        ..color = _brand.withValues(alpha: opacity)
        ..maskFilter = MaskFilter.blur(BlurStyle.normal, sigmaPx * SealGeometry.viewBox / size),
    );
  }

  @override
  bool shouldRepaint(_GlowPainter old) => old.sigmaPx != sigmaPx || old.opacity != opacity || old.size != size;
}

/// Badge, sheen, pattern rings and glint. Repaints every frame only while Verified is moving.
class _BodyPainter extends CustomPainter {
  _BodyPainter({required this.spec, required this.shimmer, required this.clock})
    : super(repaint: shimmer ? clock : null);
  final SealSpec? spec;
  final bool shimmer;
  final Animation<double>? clock;

  @override
  void paint(Canvas canvas, Size size) {
    _scaleToBox(canvas, size);
    final t = clock?.value ?? 0;
    final spec = this.spec;
    final b = _scallop.bounds;
    canvas.drawPath(
      _scallop.path,
      Paint()..shader = ui.Gradient.linear(b.topLeft, b.bottomRight, sealColors(spec?.colors), const [0, .55, 1]),
    );
    if (spec == null) return;
    final sweep = clock == null ? null : _sweepX(t);

    if (shimmer) {
      // Rainbow sheen, screened onto the badge: faint all the time, bright inside the sweep band.
      final sheenAngle = 120 + 360 * t / 14;
      canvas.save();
      canvas.clipPath(_scallop.path);
      canvas.saveLayer(_box, Paint()..blendMode = BlendMode.screen);
      canvas.drawRect(_box, Paint()..shader = _holoShader(sheenAngle, .16));
      if (sweep != null) {
        canvas.saveLayer(_box, Paint());
        canvas.drawRect(_box, Paint()..shader = _holoShader(sheenAngle, .55));
        _applySweepMask(canvas, sweep);
        canvas.restore();
      }
      canvas.restore();
      canvas.restore();
    }

    final outer = _parsedPattern(spec.outerPath);
    final inner = _parsedPattern(spec.innerPath);
    if (outer == null || inner == null) return;
    final holoAngle = 360 * t / 8;
    final outerTurn = -360 * t / 48;
    final innerTurn = 360 * t / 30;

    void ring(Path path, double turn, Paint paint) {
      canvas.save();
      _rotateAboutCentre(canvas, turn);
      canvas.drawPath(path, paint);
      canvas.restore();
    }

    Paint stroke(double width) => Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = width
      ..strokeJoin = StrokeJoin.round;

    canvas.save();
    canvas.clipPath(Path()..addOval(Rect.fromCircle(center: _centre, radius: SealGeometry.patternClipR)));
    if (shimmer) {
      ring(outer, outerTurn, stroke(.35)..shader = _holoShader(holoAngle, .45));
      ring(inner, innerTurn, stroke(.35)..shader = _holoShader(holoAngle, .35));
      if (sweep != null) {
        canvas.saveLayer(_box, Paint());
        ring(outer, outerTurn, stroke(.7)..shader = _holoShader(holoAngle, 1));
        ring(inner, innerTurn, stroke(.7)..shader = _holoShader(holoAngle, 1));
        _applySweepMask(canvas, sweep);
        canvas.restore();
      }
    } else {
      ring(outer, 0, stroke(.35)..color = _white.withValues(alpha: .2));
      ring(inner, 0, stroke(.35)..color = _white.withValues(alpha: .14));
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_BodyPainter old) => old.spec != spec || old.shimmer != shimmer || old.clock != clock;
}

/// Pattern paths are parsed once per spec string.
final Map<String, Path?> _patternCache = {};
Path? _parsedPattern(String d) {
  if (_patternCache.length > 64) _patternCache.clear();
  return _patternCache.putIfAbsent(d, () {
    try {
      return parseSvgPath(d).path;
    } on FormatException {
      return null;
    }
  });
}

/// Inner circle, AM mark and seal code. Never repaints.
class _CentrePainter extends CustomPainter {
  const _CentrePainter(this.code);
  final String? code;

  @override
  void paint(Canvas canvas, Size size) {
    _scaleToBox(canvas, size);
    canvas.drawCircle(
      _centre,
      SealGeometry.innerCircleR.toDouble(),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1
        ..color = _white.withValues(alpha: .45),
    );

    canvas.save();
    canvas.translate(SealGeometry.markTranslateX, SealGeometry.markTranslateY);
    canvas.scale(SealGeometry.markScale);
    canvas.translate(-SealGeometry.markOriginX, -SealGeometry.markOriginY);
    canvas.drawPath(_amMark, Paint()..color = _white);
    canvas.restore();

    final code = this.code;
    if (code == null) return;
    final tp = TextPainter(
      text: TextSpan(
        text: code,
        style: const TextStyle(
          fontFamily: 'AMSealMono',
          fontSize: 6.6,
          fontWeight: FontWeight.w700,
          letterSpacing: .6,
          color: _white,
          height: 1,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    final baseline = tp.computeDistanceToActualBaseline(TextBaseline.alphabetic);
    tp.paint(canvas, Offset(60 - tp.width / 2, 80 - baseline));
    tp.dispose();
  }

  @override
  bool shouldRepaint(_CentrePainter old) => old.code != code;
}

/// "GENUINE · SEALED · AUTHENTIC MATERIALS ·" on the r = 40 circle, starting at 9 o'clock and
/// running clockwise, stretched to 248 units like the SVG `textLength`. Painted once; it turns by transform.
class _TextRingPainter extends CustomPainter {
  const _TextRingPainter();

  static const _text = 'GENUINE · SEALED · AUTHENTIC MATERIALS ·';
  static const _textLength = 248.0;
  static const _style = TextStyle(
    fontFamily: 'AMSealSans',
    fontSize: 8,
    fontWeight: FontWeight.w800,
    color: _white,
    height: 1,
  );

  @override
  void paint(Canvas canvas, Size size) {
    _scaleToBox(canvas, size);
    final glyphs = [
      for (final ch in _text.characters)
        TextPainter(
          text: TextSpan(text: ch, style: _style),
          textDirection: TextDirection.ltr,
        )..layout(),
    ];
    final natural = glyphs.fold<double>(0, (sum, g) => sum + g.width);
    final gap = (_textLength - natural) / glyphs.length;
    var along = 0.0;
    for (final g in glyphs) {
      final mid = along + g.width / 2;
      final angle = math.pi + mid / SealGeometry.ringRadius;
      final baseline = g.computeDistanceToActualBaseline(TextBaseline.alphabetic);
      canvas.save();
      canvas.translate(60 + SealGeometry.ringRadius * math.cos(angle), 60 + SealGeometry.ringRadius * math.sin(angle));
      canvas.rotate(angle + math.pi / 2);
      g.paint(canvas, Offset(-g.width / 2, -baseline));
      canvas.restore();
      along += g.width + gap;
      g.dispose();
    }
  }

  @override
  bool shouldRepaint(_TextRingPainter old) => false;
}
