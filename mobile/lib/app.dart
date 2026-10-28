import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app_providers.dart';
import 'core/links/web_links.dart';
import 'core/theme/app_theme.dart';
import 'routing/app_router.dart';

class AuthenticMaterialsApp extends ConsumerStatefulWidget {
  const AuthenticMaterialsApp({super.key, this.appLinks});

  /// Injected in tests; the real plugin otherwise.
  final AppLinks? appLinks;

  @override
  ConsumerState<AuthenticMaterialsApp> createState() => _AuthenticMaterialsAppState();
}

class _AuthenticMaterialsAppState extends ConsumerState<AuthenticMaterialsApp> {
  StreamSubscription<Uri>? _links;

  @override
  void initState() {
    super.initState();
    ref.read(updateGateProvider.notifier).check();
    final appLinks = widget.appLinks ?? AppLinks();
    // uriLinkStream also delivers the link that launched the app.
    _links = appLinks.uriLinkStream.listen(_onLink, onError: (_) {});
  }

  void _onLink(Uri uri) {
    final link = parseIncomingLink(uri, webHost: ref.read(appConfigProvider).webHost);
    if (link?.emailHint != null) ref.read(emailHintProvider.notifier).state = link!.emailHint;
    // The gates decide the screen; an /app/open link never navigates by itself.
  }

  @override
  void dispose() {
    _links?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'AM - Creator',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.dark,
      routerConfig: ref.watch(routerProvider),
    );
  }
}
