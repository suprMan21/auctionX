// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'upload_progress.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_UploadProgress _$UploadProgressFromJson(Map<String, dynamic> json) =>
    _UploadProgress(
      bytesSent: (json['bytesSent'] as num).toInt(),
      totalBytes: (json['totalBytes'] as num).toInt(),
    );

Map<String, dynamic> _$UploadProgressToJson(_UploadProgress instance) =>
    <String, dynamic>{
      'bytesSent': instance.bytesSent,
      'totalBytes': instance.totalBytes,
    };
