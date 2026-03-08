import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'app.dart';
import 'core/constants/api_constants.dart';
import 'features/nfc/domain/entities/pending_scan.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Disable runtime font fetching — bundle fonts for offline reliability
  GoogleFonts.config.allowRuntimeFetching = false;

  // Initialize Hive for offline scan queue
  await Hive.initFlutter();
  Hive.registerAdapter(PendingScanAdapter());
  await Hive.openBox<PendingScan>('pending_scans');

  await Supabase.initialize(
    url: ApiConstants.supabaseUrl,
    anonKey: ApiConstants.supabaseAnonKey,
  );

  runApp(
    const ProviderScope(
      child: AuctionXApp(),
    ),
  );
}
