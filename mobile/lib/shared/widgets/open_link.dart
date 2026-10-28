import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

/// Opens a web page in the phone's browser (not an in-app view, so the
/// person's saved passwords and passkeys work there). Shows a message when the
/// link can't be opened.
Future<void> openExternal(BuildContext context, Uri uri) async {
  final messenger = ScaffoldMessenger.of(context);
  final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
  if (!ok) {
    messenger.showSnackBar(
      SnackBar(content: Text("Couldn't open ${uri.host}. Try again in your browser.")),
    );
  }
}
