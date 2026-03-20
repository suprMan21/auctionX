import 'package:freezed_annotation/freezed_annotation.dart';

part 'nft_display.freezed.dart';
part 'nft_display.g.dart';

@freezed
abstract class NftDisplay with _$NftDisplay {
  const factory NftDisplay({
    required String verificationNumber,
    required String itemName,
    String? itemImage,
    String? sellerName,
    required int verifiedCount,
  }) = _NftDisplay;

  factory NftDisplay.fromJson(Map<String, dynamic> json) =>
      _$NftDisplayFromJson(json);
}
