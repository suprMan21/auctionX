// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'mint_result.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_MintResult _$MintResultFromJson(Map<String, dynamic> json) => _MintResult(
  tokenId: json['tokenId'] as String,
  txHash: json['txHash'] as String,
  metadataUri: json['metadataUri'] as String,
  blockExplorerUrl: json['blockExplorerUrl'] as String,
  chain: json['chain'] as String,
  contractAddress: json['contractAddress'] as String,
);

Map<String, dynamic> _$MintResultToJson(_MintResult instance) =>
    <String, dynamic>{
      'tokenId': instance.tokenId,
      'txHash': instance.txHash,
      'metadataUri': instance.metadataUri,
      'blockExplorerUrl': instance.blockExplorerUrl,
      'chain': instance.chain,
      'contractAddress': instance.contractAddress,
    };
