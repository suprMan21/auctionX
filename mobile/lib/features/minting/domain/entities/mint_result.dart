import 'package:freezed_annotation/freezed_annotation.dart';

part 'mint_result.freezed.dart';
part 'mint_result.g.dart';

@freezed
abstract class MintResult with _$MintResult {
  const factory MintResult({
    required String tokenId,
    required String txHash,
    required String metadataUri,
    required String blockExplorerUrl,
    required String chain,
    required String contractAddress,
  }) = _MintResult;

  factory MintResult.fromJson(Map<String, dynamic> json) =>
      _$MintResultFromJson(json);
}
