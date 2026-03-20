// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'registration_result.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_RegistrationResult _$RegistrationResultFromJson(Map<String, dynamic> json) =>
    _RegistrationResult(
      tagId: json['tagId'] as String,
      tagUid: json['tagUid'] as String,
      itemId: json['itemId'] as String,
      status: json['status'] as String,
    );

Map<String, dynamic> _$RegistrationResultToJson(_RegistrationResult instance) =>
    <String, dynamic>{
      'tagId': instance.tagId,
      'tagUid': instance.tagUid,
      'itemId': instance.itemId,
      'status': instance.status,
    };
