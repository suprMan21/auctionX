import 'package:authentic_materials/features/seal/data/seal_reader.dart';
import 'package:authentic_materials/features/seal/presentation/seal_take_screen.dart';
import 'package:authentic_materials/features/seal/seal_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/api_client_test.dart' show FakeAdapter;
import 'seal_data_test.dart' show sealApiWith;
import 'seal_fakes.dart';

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  late FakeSealReader reader;
  late FakeRecorder recorder;
  late DateTime now;

  Future<void> open(WidgetTester tester, {TakeArgs args = const TakeArgs()}) async {
    reader = FakeSealReader();
    recorder = FakeRecorder();
    now = DateTime.utc(2026, 10, 29, 20);
    tester.view.physicalSize = const Size(1200, 4000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(ProviderScope(
      overrides: [
        sealReaderProvider.overrideWithValue(reader),
        takeRecorderFactoryProvider.overrideWithValue(() => recorder),
        takeClockProvider.overrideWithValue(() => now),
        sealApiProvider.overrideWithValue(sealApiWith(FakeAdapter(503, {}))),
      ],
      child: MaterialApp(home: SealTakeScreen(args: args)),
    ));
    await tester.pump();
  }

  Future<void> countdown(WidgetTester tester) async {
    for (var i = 0; i < 4; i++) {
      await tester.pump(const Duration(seconds: 1));
    }
  }

  testWidgets('tap 1 → 3, 2, 1 → recording → wrong seal refused → tap 2 stops → review', (tester) async {
    await open(tester);
    expect(find.textContaining('Tap the loose seal to start'), findsOneWidget);

    reader.results.add(sealUrl());
    await tester.tap(find.text('Tap the seal to start'));
    await tester.pump();
    expect(find.text('3'), findsOneWidget);
    expect(recorder.starts, 0, reason: 'nothing records during the countdown');
    await countdown(tester);
    expect(recorder.starts, 1);
    expect(find.textContaining('apply the seal on camera'), findsOneWidget);
    expect(find.textContaining('REC 0:00'), findsOneWidget);

    now = now.add(const Duration(seconds: 40));
    reader.results.add(sealUrl(serial: serialB));
    await tester.tap(find.text('Tap the seal to finish'));
    await tester.pump();
    expect(find.textContaining('That’s a different seal'), findsOneWidget);
    expect(recorder.recording, isTrue, reason: 'a wrong seal never stops the take');

    reader.results.add(sealUrl(picc: 'C1B2C3D4E5F60718293A4B5C6D7E8F90'));
    await tester.tap(find.text('Tap the seal to finish'));
    await tester.pump();
    await tester.pump();
    expect(recorder.stops, 1);
    expect(find.text('Watch your take', skipOffstage: false), findsOneWidget);
    expect(find.text('Seal it', skipOffstage: false), findsOneWidget);
    expect(find.text('Redo', skipOffstage: false), findsOneWidget);
    expect(reader.prompts, hasLength(3));
  });

  testWidgets('15 seconds left at 1:45; the take is over at 2:00', (tester) async {
    await open(tester);
    reader.results.add(sealUrl());
    await tester.tap(find.text('Tap the seal to start'));
    await tester.pump();
    await countdown(tester);

    now = now.add(const Duration(minutes: 1, seconds: 45));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('15 seconds left'), findsOneWidget);

    now = now.add(const Duration(seconds: 15));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump();
    expect(find.textContaining('Time’s up'), findsOneWidget);
    expect(find.text('Is the seal already on the piece?'), findsOneWidget);
    expect(recorder.recording, isFalse);
  });

  testWidgets('tap 2 read after 2:00 can’t finish the take', (tester) async {
    await open(tester);
    reader.results.add(sealUrl());
    await tester.tap(find.text('Tap the seal to start'));
    await tester.pump();
    await countdown(tester);
    await tester.tap(find.text('Tap the seal to finish'));
    await tester.pump();
    // The tap arrives late (the sheet was open while the clock ran out).
    now = now.add(const Duration(minutes: 2, seconds: 1));
    reader.results.add(sealUrl());
    reader.cancel();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump();
    expect(find.textContaining('Time’s up'), findsOneWidget);
  });

  testWidgets('an older chip or a failed read explains itself and stays on tap 1', (tester) async {
    await open(tester);
    reader.results.add('https://x.test/verify/chip_001?picc_data=A1B2C3D4E5F60718293A4B5C6D7E8F90&cmac=0011223344556677');
    await tester.tap(find.text('Tap the seal to start'));
    await tester.pump();
    expect(find.textContaining('older kind'), findsOneWidget);
    reader.results.add(const SealReadException(SealReadFailure.unavailable));
    await tester.tap(find.text('Tap the seal to start'));
    await tester.pump();
    expect(find.textContaining('NFC is off'), findsOneWidget);
    expect(recorder.starts, 0);
  });

  testWidgets('practice reads no seal and says nothing is kept', (tester) async {
    await open(tester, args: const TakeArgs(practice: true));
    expect(find.text('PRACTICE · nothing is kept'), findsOneWidget);
    await tester.tap(find.text('Pretend to tap the seal'));
    await tester.pump();
    await countdown(tester);
    await tester.tap(find.text('Pretend to tap the seal'));
    await tester.pump();
    await tester.pump();
    expect(find.text('Practice again', skipOffstage: false), findsOneWidget);
    expect(find.text('Seal it', skipOffstage: false), findsNothing);
    expect(reader.prompts, isEmpty);
  });

  testWidgets('a redo starts from the seal on the piece', (tester) async {
    await open(tester, args: const TakeArgs(sealAlreadyOn: true));
    expect(find.textContaining('The seal is already on'), findsOneWidget);
    reader.results.add(sealUrl());
    await tester.tap(find.text('Tap the seal to start'));
    await tester.pump();
    await countdown(tester);
    expect(find.textContaining('Tap the seal again to finish'), findsOneWidget);
  });
}
