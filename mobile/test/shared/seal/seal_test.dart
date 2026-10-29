import 'dart:convert';
import 'dart:io';

import 'package:authentic_materials/shared/seal/seal_badge.dart';
import 'package:authentic_materials/shared/seal/seal_geometry.dart';
import 'package:authentic_materials/shared/seal/seal_spec.dart';
import 'package:authentic_materials/shared/seal/svg_path.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// Same pinned value as backend/src/lib/seal/geometry.test.ts and the website's sealGeometry.test.ts.
const sealGeometrySha256 = 'f7796b2b6a16b6cfd41279a1e4e24ac64d074dceef3524b70a1470e53ab57434';

Object? fixture(String code) => jsonDecode(File('test/shared/seal/fixtures/$code.json').readAsStringSync());

Future<void> loadSealFonts() async {
  final sans = FontLoader('AMSealSans')..addFont(rootBundle.load('assets/fonts/PlusJakartaSans-ExtraBold.ttf'));
  final mono = FontLoader('AMSealMono')..addFont(rootBundle.load('assets/fonts/IBMPlexMono-Bold.ttf'));
  await Future.wait([sans.load(), mono.load()]);
}

Widget host(Widget child, {bool disableAnimations = false}) => MediaQuery(
  data: MediaQueryData(disableAnimations: disableAnimations),
  child: Directionality(
    textDirection: TextDirection.ltr,
    child: ColoredBox(
      color: const Color(0xFF13131A),
      child: Center(
        child: RepaintBoundary(
          child: Padding(padding: const EdgeInsets.all(24), child: child),
        ),
      ),
    ),
  ),
);

void main() {
  setUpAll(loadSealFonts);

  group('geometry', () {
    test('matches the pinned hash shared with the website and the server', () {
      expect(sha256.convert(utf8.encode(jsonEncode(SealGeometry.asJson))).toString(), sealGeometrySha256);
    });
  });

  group('parseSvgPath', () {
    test('reads relative steps with packed negatives and leading dots', () {
      final p = parseSvgPath('M10 10l.5-.5l-1.5 2l0 .3Z');
      expect(p.bounds.left, closeTo(9, 1e-9));
      expect(p.bounds.top, closeTo(9.5, 1e-9));
      expect(p.bounds.right, closeTo(10.5, 1e-9));
      expect(p.bounds.bottom, closeTo(11.8, 1e-9));
    });

    test('tight bounds of the scallop ignore control points', () {
      final b = parseSvgPath(SealGeometry.scallop).bounds;
      // Control points reach x 1.80 / 118.20; the curve itself stays inside them.
      expect(b.left, greaterThan(1.8));
      expect(b.right, lessThan(118.2));
      expect(b.top, greaterThan(2.12));
    });

    test('refuses commands the seal never uses', () {
      expect(() => parseSvgPath('M0 0C1 1 2 2 3 3Z'), throwsFormatException);
      expect(() => parseSvgPath('M0 0A1 1 0 0 1 2 2'), throwsFormatException);
      expect(() => parseSvgPath('5 5'), throwsFormatException);
    });

    test('reads every pattern path of the real specs', () {
      for (final code in ['WAV4F6TT', 'GPKD67QP']) {
        final spec = SealSpec.tryParse(fixture(code))!;
        for (final d in [spec.outerPath, spec.innerPath]) {
          final b = parseSvgPath(d).bounds;
          // Pattern stays inside the badge's inner circle.
          expect(b.left, greaterThan(60 - 31));
          expect(b.right, lessThan(60 + 31));
        }
      }
    });
  });

  group('SealSpec.tryParse', () {
    test('accepts a v1 spec from the backend', () {
      final spec = SealSpec.tryParse(fixture('WAV4F6TT'));
      expect(spec, isNotNull);
      expect(spec!.colors, 'am-default');
    });

    Map<String, Object?> mutate(void Function(Map<String, dynamic>) f) {
      final j = jsonDecode(jsonEncode(fixture('WAV4F6TT'))) as Map<String, dynamic>;
      f(j);
      return j;
    }

    test('refuses anything that is not a v1 hypotrochoid spec', () {
      expect(SealSpec.tryParse(null), isNull);
      expect(SealSpec.tryParse('x'), isNull);
      expect(SealSpec.tryParse(mutate((j) => j['v'] = 2)), isNull);
      expect(SealSpec.tryParse(mutate((j) => j['pattern']['kind'] = 'spiral')), isNull);
      expect(SealSpec.tryParse(mutate((j) => j['pattern']['version'] = 2)), isNull);
      expect(SealSpec.tryParse(mutate((j) => (j['pattern']['paths'] as List).removeLast())), isNull);
      // Only M / l / Z: an absolute line or a curve is refused, like the website and the server.
      expect(SealSpec.tryParse(mutate((j) => j['pattern']['paths'][0] = 'M0 0L5 5Z')), isNull);
      expect(SealSpec.tryParse(mutate((j) => j['pattern']['paths'][1] = 'M0 0c1 1 2 2 3 3Z')), isNull);
    });

    test('unknown colour keys fall back to the AM pair', () {
      final spec = SealSpec.tryParse(mutate((j) => j['colors'] = 'neon'))!;
      expect(sealColors(spec.colors), sealColorPairs['am-default']);
    });
  });

  group('seal code', () {
    test('display form only, Crockford base32', () {
      expect(isSealCode('WAV4-F6TT'), isTrue);
      expect(isSealCode('WAV4F6TT'), isFalse);
      expect(isSealCode('WAV4-F6TI'), isFalse); // I is not Crockford
      expect(isSealCode('wav4-f6tt'), isFalse);
    });
  });

  group('SealBadge motion', () {
    final spec = SealSpec.tryParse(fixture('WAV4F6TT'));

    testWidgets('Verified keeps moving', (tester) async {
      await tester.pumpWidget(host(SealBadge(code: 'WAV4-F6TT', spec: spec)));
      await tester.pump(const Duration(seconds: 2));
      expect(tester.binding.hasScheduledFrame, isTrue);
    });

    testWidgets('Sealed never moves', (tester) async {
      await tester.pumpWidget(host(SealBadge(code: 'WAV4-F6TT', spec: spec, state: SealState.sealed)));
      await tester.pump(const Duration(seconds: 2));
      expect(tester.binding.hasScheduledFrame, isFalse);
    });

    testWidgets('Remove animations stops Verified', (tester) async {
      await tester.pumpWidget(host(SealBadge(code: 'WAV4-F6TT', spec: spec), disableAnimations: true));
      await tester.pump(const Duration(seconds: 2));
      expect(tester.binding.hasScheduledFrame, isFalse);
    });

    testWidgets('iOS Reduce Motion stops Verified, also when switched on while showing', (tester) async {
      await tester.pumpWidget(host(SealBadge(code: 'WAV4-F6TT', spec: spec)));
      await tester.pump(const Duration(milliseconds: 100));
      expect(tester.binding.hasScheduledFrame, isTrue);

      tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(reduceMotion: true);
      addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      expect(tester.binding.hasScheduledFrame, isFalse);
    });

    testWidgets('a label makes it one image for screen readers; no label hides it', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(host(SealBadge(code: 'WAV4-F6TT', spec: spec, label: 'Verified seal WAV4-F6TT')));
      expect(find.bySemanticsLabel('Verified seal WAV4-F6TT'), findsOneWidget);
      await tester.pumpWidget(host(SealBadge(code: 'WAV4-F6TT', spec: spec, state: SealState.sealed)));
      expect(find.bySemanticsLabel(RegExp('WAV4')), findsNothing);
      handle.dispose();
    });

    testWidgets('a malformed code is caught in debug builds', (tester) async {
      await tester.pumpWidget(host(SealBadge(code: '04A27E02936980', spec: spec)));
      expect(tester.takeException(), isAssertionError);
    });
  });

  // Goldens are drawn on macOS (Boss's Mac); regenerate with `flutter test --update-goldens test/shared/seal`.
  group('SealBadge goldens', () {
    final wav = SealSpec.tryParse(fixture('WAV4F6TT'));
    final gpk = SealSpec.tryParse(fixture('GPKD67QP'));

    Future<void> golden(
      WidgetTester tester,
      Widget badge,
      String name, {
      Duration at = Duration.zero,
      bool reduce = false,
    }) async {
      await tester.binding.setSurfaceSize(const Size(560, 560));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(host(badge, disableAnimations: reduce));
      await tester.pump(at);
      await expectLater(find.byType(SealBadge), matchesGoldenFile('goldens/$name.png'));
    }

    testWidgets(
      'sealed',
      (tester) =>
          golden(tester, SealBadge(code: 'WAV4-F6TT', spec: wav, state: SealState.sealed, size: 480), 'sealed_wav4'),
    );
    testWidgets(
      'sealed, other seal',
      (tester) =>
          golden(tester, SealBadge(code: 'GPKD-67QP', spec: gpk, state: SealState.sealed, size: 480), 'sealed_gpkd'),
    );
    testWidgets(
      'generic (no code, no spec)',
      (tester) => golden(tester, const SealBadge(state: SealState.sealed, size: 480), 'generic'),
    );
    testWidgets(
      'verified, reduce motion',
      (tester) => golden(tester, SealBadge(code: 'WAV4-F6TT', spec: wav, size: 480), 'verified_still', reduce: true),
    );
    testWidgets(
      'verified, mid glint',
      (tester) => golden(
        tester,
        SealBadge(code: 'WAV4-F6TT', spec: wav, size: 480),
        'verified_glint',
        at: const Duration(milliseconds: 2500),
      ),
    );
    testWidgets(
      'verified, small',
      (tester) => golden(tester, SealBadge(code: 'WAV4-F6TT', spec: wav, size: 44), 'verified_small', reduce: true),
    );
  });
}
