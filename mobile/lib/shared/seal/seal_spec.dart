import 'dart:ui';

/// S-SEAL1: the public part of a seal spec, as the backend sends it (`sealSpec` on the tap and
/// My Seals responses; lib/seal/ensureSealSpec.ts). The pattern is decoration seeded from the
/// public seal code; only a tap proves a seal.
class SealSpec {
  const SealSpec._({required this.colors, required this.outerPath, required this.innerPath});

  /// Key into [sealColorPairs]. One pair until S-SEAL2 (creator choice).
  final String colors;

  /// Pattern v1 rings in the 120 × 120 badge box.
  final String outerPath;
  final String innerPath;

  /// Only M / l / Z path commands are ever drawn (same rule as the server and the website).
  static final _path = RegExp(r'^M[-\d. l]+Z$');

  /// A stored path is a few thousand characters; anything far bigger is not a seal spec.
  static const _maxPathLength = 20000;

  /// The spec, or null when the value is missing or not a v1 spec. A seal without a spec is still
  /// drawn, just without its pattern (same as the website and the server).
  static SealSpec? tryParse(Object? json) {
    if (json is! Map) return null;
    final pattern = json['pattern'];
    if (json['v'] != 1 || pattern is! Map) return null;
    if (pattern['kind'] != 'hypotrochoid' || pattern['version'] != 1) return null;
    final paths = pattern['paths'];
    if (paths is! List || paths.length != 2) return null;
    final [outer, inner] = paths;
    bool ok(Object? p) => p is String && p.length <= _maxPathLength && _path.hasMatch(p);
    if (!ok(outer) || !ok(inner)) return null;
    final colors = json['colors'];
    return SealSpec._(
      colors: colors is String ? colors : 'am-default',
      outerPath: outer as String,
      innerPath: inner as String,
    );
  }
}

/// Colour pairs by key (same values as the website and the server). Unknown keys fall back to the AM pair.
const Map<String, List<Color>> sealColorPairs = {
  'am-default': [Color(0xFFA78BFA), Color(0xFF7C3AED), Color(0xFF3B82F6)],
};

List<Color> sealColors(String? key) => sealColorPairs[key] ?? sealColorPairs['am-default']!;

/// Locked seal_code format: 8 Crockford base32 characters, shown as XXXX-XXXX.
final sealCodePattern = RegExp(r'^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$');

bool isSealCode(Object? value) => value is String && sealCodePattern.hasMatch(value);
