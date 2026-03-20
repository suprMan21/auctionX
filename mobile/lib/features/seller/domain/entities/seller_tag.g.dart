// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'seller_tag.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_SellerTag _$SellerTagFromJson(Map<String, dynamic> json) => _SellerTag(
  id: json['id'] as String,
  tagUid: json['tagUid'] as String,
  itemId: json['itemId'] as String,
  tenantId: json['tenantId'] as String,
  status: json['status'] as String,
  listingTitle: json['listingTitle'] as String?,
  nftTokenId: json['nftTokenId'] as String?,
  scanCount: (json['scanCount'] as num?)?.toInt() ?? 0,
  registeredAt: DateTime.parse(json['registeredAt'] as String),
);

Map<String, dynamic> _$SellerTagToJson(_SellerTag instance) =>
    <String, dynamic>{
      'id': instance.id,
      'tagUid': instance.tagUid,
      'itemId': instance.itemId,
      'tenantId': instance.tenantId,
      'status': instance.status,
      'listingTitle': instance.listingTitle,
      'nftTokenId': instance.nftTokenId,
      'scanCount': instance.scanCount,
      'registeredAt': instance.registeredAt.toIso8601String(),
    };
