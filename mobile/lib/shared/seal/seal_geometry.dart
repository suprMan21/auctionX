/// Seal geometry shared by every drawing of the seal (S-SEAL1). The same constants live in
/// backend/src/lib/seal/geometry.ts and frontend/src/components/seal/geometry.ts; a test on each
/// side hashes them against one pinned value, so the copies cannot drift.
/// Change all three files and the pinned hash together.
class SealGeometry {
  SealGeometry._();

  static const int viewBox = 120;

  /// Scalloped badge outline.
  static const String scallop =
      'M60.00 6.00Q66.08 2.12 71.23 7.18Q77.98 4.65 81.96 10.67Q89.10 9.60 91.74 16.31Q98.94 16.75 100.13 23.87Q107.08 25.79 106.77 33.00Q113.17 36.33 111.36 43.31Q116.93 47.90 113.70 54.36Q118.20 60.00 113.70 65.64Q116.93 72.10 111.36 76.69Q113.17 83.67 106.77 87.00Q107.08 94.21 100.13 96.13Q98.94 103.25 91.74 103.69Q89.10 110.40 81.96 109.33Q77.98 115.35 71.23 112.82Q66.08 117.88 60.00 114.00Q53.92 117.88 48.77 112.82Q42.02 115.35 38.04 109.33Q30.90 110.40 28.26 103.69Q21.06 103.25 19.87 96.13Q12.92 94.21 13.23 87.00Q6.83 83.67 8.64 76.69Q3.07 72.10 6.30 65.64Q1.80 60.00 6.30 54.36Q3.07 47.90 8.64 43.31Q6.83 36.33 13.23 33.00Q12.92 25.79 19.87 23.87Q21.06 16.75 28.26 16.31Q30.90 9.60 38.04 10.67Q42.02 4.65 48.77 7.18Q53.92 2.12 60.00 6.00Z';

  /// AM mark, drawn at translate(60 55) scale(.44) translate(-50 -44).
  static const String amMark =
      'M51.63 64.00L42.84 64.00L42.72 55.53L29.76 55.53L24.22 64.00L16.12 64.00L43.55 24.00L55.64 24.00L63.80 50.10L63.90 50.10L72.11 24.00L83.88 24.00L83.88 64.00L76.07 64.00L76.07 33.32L75.97 33.32L66.66 64.00L60.70 64.00L51.73 33.32L51.63 33.32L51.63 64.00ZM42.59 35.64L34.49 48.07L42.65 48.07L42.59 35.64Z';
  static const String amMarkTransform = 'translate(60 55) scale(.44) translate(-50 -44)';

  /// Circle the text ring follows (r = 40).
  static const String ringPath = 'M60 60m-40 0a40 40 0 1 1 80 0a40 40 0 1 1 -80 0';

  /// Thin inner circle; the pattern is clipped just inside it.
  static const int innerCircleR = 31;
  static const double patternClipR = 30.5;

  /// Same keys, order and values as the TypeScript object, for the shared hash.
  static const Map<String, Object> asJson = {
    'viewBox': viewBox,
    'scallop': scallop,
    'amMark': amMark,
    'amMarkTransform': amMarkTransform,
    'ringPath': ringPath,
    'innerCircleR': innerCircleR,
    'patternClipR': patternClipR,
  };

  // Values the painter uses, read from the strings above (kept next to them so they change together).
  static const double ringRadius = 40;
  static const double markTranslateX = 60;
  static const double markTranslateY = 55;
  static const double markScale = .44;
  static const double markOriginX = 50;
  static const double markOriginY = 44;
}
