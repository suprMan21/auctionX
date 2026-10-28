/// A plain `major.minor.patch` version, used for the minimum-version check.
class AppVersion implements Comparable<AppVersion> {
  const AppVersion(this.major, this.minor, this.patch);

  final int major;
  final int minor;
  final int patch;

  static final _pattern = RegExp(r'^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$');

  /// Null for anything that is not exactly `x.y.z` (build suffixes such as
  /// `+5` are dropped first).
  static AppVersion? tryParse(String? raw) {
    if (raw == null) return null;
    final m = _pattern.firstMatch(raw.split('+').first.trim());
    if (m == null) return null;
    return AppVersion(int.parse(m[1]!), int.parse(m[2]!), int.parse(m[3]!));
  }

  @override
  int compareTo(AppVersion other) {
    if (major != other.major) return major.compareTo(other.major);
    if (minor != other.minor) return minor.compareTo(other.minor);
    return patch.compareTo(other.patch);
  }

  bool operator <(AppVersion other) => compareTo(other) < 0;

  @override
  bool operator ==(Object other) => other is AppVersion && compareTo(other) == 0;

  @override
  int get hashCode => Object.hash(major, minor, patch);

  @override
  String toString() => '$major.$minor.$patch';
}
