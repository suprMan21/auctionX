import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:path_provider/path_provider.dart';

/// SHA-256 of the file, lowercase hex, read in chunks (a 2-minute 1080p take is ~200 MB).
Future<String> sha256OfFile(File file) async => (await sha256.bind(file.openRead()).first).toString();

/// Where seal videos wait for upload (Ph C): the app's private support folder, never the photo library.
class SealVideoStore {
  SealVideoStore({Future<Directory> Function()? root}) : _root = root ?? getApplicationSupportDirectory;

  final Future<Directory> Function() _root;

  Future<Directory> _dir() async {
    final dir = Directory('${(await _root()).path}/seal-videos');
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir;
  }

  /// Moves a finished recording in, named after the take.
  Future<File> keep(String recordedPath, String takeId) async {
    final ext = recordedPath.contains('.') ? recordedPath.substring(recordedPath.lastIndexOf('.')) : '.mp4';
    final target = File('${(await _dir()).path}/$takeId$ext');
    final source = File(recordedPath);
    try {
      return await source.rename(target.path);
    } on FileSystemException {
      // Different volume (the camera writes to a temp folder): copy, then remove the temp file.
      final copied = await source.copy(target.path);
      await source.delete();
      return copied;
    }
  }

  /// Practice takes and abandoned takes are never kept.
  static Future<void> discard(String? path) async {
    if (path == null) return;
    final f = File(path);
    if (await f.exists()) await f.delete();
  }
}
