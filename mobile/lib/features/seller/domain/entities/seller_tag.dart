import 'package:freezed_annotation/freezed_annotation.dart';

part 'seller_tag.freezed.dart';
part 'seller_tag.g.dart';

@freezed
sealed class SellerTag with _$SellerTag {
  const factory SellerTag({
    required String id,
    required String tagUid,
    required String itemId,
    required String tenantId,
    required String status,
    String? listingTitle,
    String? nftTokenId,
    @Default(0) int scanCount,
    required DateTime registeredAt,
  }) = _SellerTag;

  factory SellerTag.fromJson(Map<String, dynamic> json) =>
      _$SellerTagFromJson(json);
}
