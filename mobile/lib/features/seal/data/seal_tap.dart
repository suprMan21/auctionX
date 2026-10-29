/// One read of a seal by the app (S-MOB2).
///
/// The app never checks a tap itself: the MAC is checked on the server with keys
/// derived in KMS. The app keeps the URL exactly as the chip wrote it and only
/// reads the serial out of it, to tell "same seal" from "a different seal".
library;

class SealTap {
  const SealTap({required this.url, required this.serial, required this.readAt});

  /// The full SUN URL the chip produced (sent to the server as is).
  final String url;

  /// `sn=` from the URL: 16 uppercase hex characters (KDF v2 chips only).
  final String serial;

  /// Device time of the read. Untrusted; the server records it as device-reported.
  final DateTime readAt;

  Map<String, dynamic> toJson() => {'url': url, 'serial': serial, 'readAt': readAt.toUtc().toIso8601String()};

  factory SealTap.fromJson(Map<String, dynamic> json) => SealTap(
        url: json['url'] as String,
        serial: json['serial'] as String,
        readAt: DateTime.parse(json['readAt'] as String),
      );
}

/// Why a read can't be used for sealing.
enum SealTapProblem {
  /// Nothing on the chip, or not a web address.
  notASeal,

  /// An older chip without a serial in its URL (v1): can't be sealed in the app.
  oldChip,
}

class SealTapException implements Exception {
  const SealTapException(this.problem);
  final SealTapProblem problem;
  @override
  String toString() => 'SealTapException($problem)';
}

final _hex16 = RegExp(r'^[0-9A-F]{16}$');
final _hex = RegExp(r'^[0-9A-Fa-f]+$');

/// NFC Forum URI record prefixes (URI RTD, table 3), the ones a seal can carry.
const _uriPrefixes = <int, String>{
  0x00: '',
  0x01: 'http://www.',
  0x02: 'https://www.',
  0x03: 'http://',
  0x04: 'https://',
};

/// Turns a well-known URI record payload (prefix byte + rest) into the URL.
String? uriFromRecordPayload(List<int> payload) {
  if (payload.isEmpty) return null;
  final prefix = _uriPrefixes[payload.first];
  if (prefix == null) return null;
  return prefix + String.fromCharCodes(payload.sublist(1));
}

/// Reads a seal URL. Throws [SealTapException] when it can't be a sealable seal.
SealTap parseSealTap(String url, DateTime readAt) {
  final uri = Uri.tryParse(url);
  if (uri == null || (uri.scheme != 'https' && uri.scheme != 'http') || uri.host.isEmpty) {
    throw const SealTapException(SealTapProblem.notASeal);
  }
  final q = uri.queryParameters;
  final picc = q['picc_data'] ?? q['e'];
  final cmac = q['cmac'] ?? q['c'];
  if (picc == null || cmac == null || picc.length != 32 || cmac.length != 16 || !_hex.hasMatch(picc + cmac)) {
    throw const SealTapException(SealTapProblem.notASeal);
  }
  final serial = q['sn']?.toUpperCase();
  if (serial == null || !_hex16.hasMatch(serial)) throw const SealTapException(SealTapProblem.oldChip);
  return SealTap(url: url, serial: serial, readAt: readAt);
}

/// The last four characters of the serial: what people compare by eye (matches the console's "serial suffix").
String serialSuffix(String serial) => serial.length <= 4 ? serial : serial.substring(serial.length - 4);
