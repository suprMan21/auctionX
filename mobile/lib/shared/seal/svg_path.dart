import 'dart:math' as math;
import 'dart:ui';

/// A parsed seal path plus its tight bounds (an SVG gradient's bounding box uses the curve itself,
/// not its control points, so `Path.getBounds` is not quite the same).
class ParsedSvgPath {
  const ParsedSvgPath(this.path, this.bounds);
  final Path path;
  final Rect bounds;
}

/// Reads the small part of SVG path syntax the seal uses: M, L, Q and Z, absolute or relative.
/// Throws [FormatException] on anything else, so a bad path is never half drawn.
ParsedSvgPath parseSvgPath(String d) {
  final tokens = RegExp(r'[MmLlQqZz]|-?(?:\d+(?:\.\d*)?|\.\d+)').allMatches(d).map((m) => m.group(0)!).toList();
  // Everything in the string must be a command, a number or a separator.
  final leftover = d.replaceAll(RegExp(r'[MmLlQqZz]|-?(?:\d+(?:\.\d*)?|\.\d+)|[\s,]'), '');
  if (leftover.isNotEmpty) throw FormatException('Unsupported path data', leftover);

  final path = Path();
  var x = 0.0, y = 0.0, startX = 0.0, startY = 0.0;
  var minX = double.infinity, minY = double.infinity, maxX = double.negativeInfinity, maxY = double.negativeInfinity;
  void grow(double px, double py) {
    minX = math.min(minX, px);
    maxX = math.max(maxX, px);
    minY = math.min(minY, py);
    maxY = math.max(maxY, py);
  }

  var i = 0;
  String? cmd;
  double num() {
    if (i >= tokens.length) throw const FormatException('Path ends early');
    final v = double.tryParse(tokens[i]);
    if (v == null) throw FormatException('Expected a number', tokens[i]);
    i++;
    return v;
  }

  bool nextIsNumber() => i < tokens.length && double.tryParse(tokens[i]) != null;

  while (i < tokens.length) {
    if (!nextIsNumber()) {
      cmd = tokens[i++];
    } else if (cmd == null || cmd == 'Z' || cmd == 'z') {
      throw const FormatException('Number without a command');
    }
    final rel = cmd == cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case 'M':
        final nx = num() + (rel ? x : 0), ny = num() + (rel ? y : 0);
        x = nx;
        y = ny;
        startX = x;
        startY = y;
        path.moveTo(x, y);
        grow(x, y);
        // Further pairs after a move are lines (SVG rule).
        cmd = rel ? 'l' : 'L';
      case 'L':
        final nx = num() + (rel ? x : 0), ny = num() + (rel ? y : 0);
        x = nx;
        y = ny;
        path.lineTo(x, y);
        grow(x, y);
      case 'Q':
        final cx = num() + (rel ? x : 0), cy = num() + (rel ? y : 0);
        final ex = num() + (rel ? x : 0), ey = num() + (rel ? y : 0);
        path.quadraticBezierTo(cx, cy, ex, ey);
        // Tight bounds: the curve's own turning points, not the control point.
        for (final t in [_quadExtremum(x, cx, ex), _quadExtremum(y, cy, ey)]) {
          if (t != null) grow(_quad(x, cx, ex, t), _quad(y, cy, ey, t));
        }
        x = ex;
        y = ey;
        grow(x, y);
      case 'Z':
        path.close();
        x = startX;
        y = startY;
      default:
        throw FormatException('Unsupported command', cmd);
    }
  }
  if (minX == double.infinity) throw const FormatException('Empty path');
  return ParsedSvgPath(path, Rect.fromLTRB(minX, minY, maxX, maxY));
}

double _quad(double a, double b, double c, double t) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;

double? _quadExtremum(double a, double b, double c) {
  final den = a - 2 * b + c;
  if (den == 0) return null;
  final t = (a - b) / den;
  return t > 0 && t < 1 ? t : null;
}
