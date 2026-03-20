import 'package:freezed_annotation/freezed_annotation.dart';

part 'upload_progress.freezed.dart';
part 'upload_progress.g.dart';

@freezed
abstract class UploadProgress with _$UploadProgress {
  const UploadProgress._();

  const factory UploadProgress({
    required int bytesSent,
    required int totalBytes,
  }) = _UploadProgress;

  double get fraction =>
      totalBytes > 0 ? (bytesSent / totalBytes).clamp(0.0, 1.0) : 0.0;

  factory UploadProgress.fromJson(Map<String, dynamic> json) =>
      _$UploadProgressFromJson(json);
}
