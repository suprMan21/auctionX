import 'package:freezed_annotation/freezed_annotation.dart';

part 'tag_detail.freezed.dart';
part 'tag_detail.g.dart';

@freezed
abstract class TagDetail with _$TagDetail {
  const factory TagDetail({
    required TagInfo tag,
    required List<VerificationEvent> events,
    NftInfo? nft,
    SellerInfo? seller,
  }) = _TagDetail;

  factory TagDetail.fromJson(Map<String, dynamic> json) =>
      _$TagDetailFromJson(json);
}

@freezed
abstract class TagInfo with _$TagInfo {
  const factory TagInfo({
    required String id,
    required String tagUid,
    String? itemId,
    String? sellerId,
    required String status,
    int? sunCounter,
    String? activatedAt,
  }) = _TagInfo;

  factory TagInfo.fromJson(Map<String, dynamic> json) =>
      _$TagInfoFromJson(json);
}

@freezed
abstract class VerificationEvent with _$VerificationEvent {
  const factory VerificationEvent({
    required String scanType,
    required bool cmacValid,
    required String createdAt,
  }) = _VerificationEvent;

  factory VerificationEvent.fromJson(Map<String, dynamic> json) =>
      _$VerificationEventFromJson(json);
}

@freezed
abstract class NftInfo with _$NftInfo {
  const factory NftInfo({
    required String chain,
    required String contractAddress,
    String? tokenId,
    String? mintTxHash,
    String? metadataUri,
  }) = _NftInfo;

  factory NftInfo.fromJson(Map<String, dynamic> json) =>
      _$NftInfoFromJson(json);
}

@freezed
abstract class SellerInfo with _$SellerInfo {
  const factory SellerInfo({
    String? username,
  }) = _SellerInfo;

  factory SellerInfo.fromJson(Map<String, dynamic> json) =>
      _$SellerInfoFromJson(json);
}
