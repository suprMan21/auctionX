// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'video_proof.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_VideoProof _$VideoProofFromJson(Map<String, dynamic> json) => _VideoProof(
  tagId: json['tagId'] as String,
  localPath: json['localPath'] as String,
  fileSizeBytes: (json['fileSizeBytes'] as num).toInt(),
  durationMs: (json['durationMs'] as num).toInt(),
  uploadUrl: json['uploadUrl'] as String?,
  publicUrl: json['publicUrl'] as String?,
  videoKey: json['videoKey'] as String?,
  proofId: json['proofId'] as String?,
);

Map<String, dynamic> _$VideoProofToJson(_VideoProof instance) =>
    <String, dynamic>{
      'tagId': instance.tagId,
      'localPath': instance.localPath,
      'fileSizeBytes': instance.fileSizeBytes,
      'durationMs': instance.durationMs,
      'uploadUrl': instance.uploadUrl,
      'publicUrl': instance.publicUrl,
      'videoKey': instance.videoKey,
      'proofId': instance.proofId,
    };
