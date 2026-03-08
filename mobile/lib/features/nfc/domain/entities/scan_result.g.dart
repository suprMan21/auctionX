// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'scan_result.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_ScanResult _$ScanResultFromJson(Map<String, dynamic> json) => _ScanResult(
  valid: json['valid'] as bool,
  tagId: json['tagId'] as String,
  eventId: json['eventId'] as String?,
  counterValue: (json['counterValue'] as num?)?.toInt(),
);

Map<String, dynamic> _$ScanResultToJson(_ScanResult instance) =>
    <String, dynamic>{
      'valid': instance.valid,
      'tagId': instance.tagId,
      'eventId': instance.eventId,
      'counterValue': instance.counterValue,
    };
