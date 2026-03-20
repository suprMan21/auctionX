// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'nft_display.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_NftDisplay _$NftDisplayFromJson(Map<String, dynamic> json) => _NftDisplay(
  verificationNumber: json['verificationNumber'] as String,
  itemName: json['itemName'] as String,
  itemImage: json['itemImage'] as String?,
  sellerName: json['sellerName'] as String?,
  verifiedCount: (json['verifiedCount'] as num).toInt(),
);

Map<String, dynamic> _$NftDisplayToJson(_NftDisplay instance) =>
    <String, dynamic>{
      'verificationNumber': instance.verificationNumber,
      'itemName': instance.itemName,
      'itemImage': instance.itemImage,
      'sellerName': instance.sellerName,
      'verifiedCount': instance.verifiedCount,
    };
