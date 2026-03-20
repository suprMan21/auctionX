// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'tag_detail.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_TagDetail _$TagDetailFromJson(Map<String, dynamic> json) => _TagDetail(
  tag: TagInfo.fromJson(json['tag'] as Map<String, dynamic>),
  events: (json['events'] as List<dynamic>)
      .map((e) => VerificationEvent.fromJson(e as Map<String, dynamic>))
      .toList(),
  nft: json['nft'] == null
      ? null
      : NftInfo.fromJson(json['nft'] as Map<String, dynamic>),
  seller: json['seller'] == null
      ? null
      : SellerInfo.fromJson(json['seller'] as Map<String, dynamic>),
);

Map<String, dynamic> _$TagDetailToJson(_TagDetail instance) =>
    <String, dynamic>{
      'tag': instance.tag,
      'events': instance.events,
      'nft': instance.nft,
      'seller': instance.seller,
    };

_TagInfo _$TagInfoFromJson(Map<String, dynamic> json) => _TagInfo(
  id: json['id'] as String,
  tagUid: json['tagUid'] as String,
  itemId: json['itemId'] as String?,
  sellerId: json['sellerId'] as String?,
  status: json['status'] as String,
  sunCounter: (json['sunCounter'] as num?)?.toInt(),
  activatedAt: json['activatedAt'] as String?,
);

Map<String, dynamic> _$TagInfoToJson(_TagInfo instance) => <String, dynamic>{
  'id': instance.id,
  'tagUid': instance.tagUid,
  'itemId': instance.itemId,
  'sellerId': instance.sellerId,
  'status': instance.status,
  'sunCounter': instance.sunCounter,
  'activatedAt': instance.activatedAt,
};

_VerificationEvent _$VerificationEventFromJson(Map<String, dynamic> json) =>
    _VerificationEvent(
      scanType: json['scanType'] as String,
      cmacValid: json['cmacValid'] as bool,
      createdAt: json['createdAt'] as String,
      videoProofStatus: json['videoProofStatus'] as String?,
    );

Map<String, dynamic> _$VerificationEventToJson(_VerificationEvent instance) =>
    <String, dynamic>{
      'scanType': instance.scanType,
      'cmacValid': instance.cmacValid,
      'createdAt': instance.createdAt,
      'videoProofStatus': instance.videoProofStatus,
    };

_NftInfo _$NftInfoFromJson(Map<String, dynamic> json) => _NftInfo(
  chain: json['chain'] as String,
  contractAddress: json['contractAddress'] as String,
  tokenId: json['tokenId'] as String?,
  mintTxHash: json['mintTxHash'] as String?,
  metadataUri: json['metadataUri'] as String?,
);

Map<String, dynamic> _$NftInfoToJson(_NftInfo instance) => <String, dynamic>{
  'chain': instance.chain,
  'contractAddress': instance.contractAddress,
  'tokenId': instance.tokenId,
  'mintTxHash': instance.mintTxHash,
  'metadataUri': instance.metadataUri,
};

_SellerInfo _$SellerInfoFromJson(Map<String, dynamic> json) =>
    _SellerInfo(username: json['username'] as String?);

Map<String, dynamic> _$SellerInfoToJson(_SellerInfo instance) =>
    <String, dynamic>{'username': instance.username};
