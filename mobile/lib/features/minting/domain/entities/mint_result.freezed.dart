// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'mint_result.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$MintResult {

 String get tokenId; String get txHash; String get metadataUri; String get blockExplorerUrl; String get chain; String get contractAddress;
/// Create a copy of MintResult
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$MintResultCopyWith<MintResult> get copyWith => _$MintResultCopyWithImpl<MintResult>(this as MintResult, _$identity);

  /// Serializes this MintResult to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is MintResult&&(identical(other.tokenId, tokenId) || other.tokenId == tokenId)&&(identical(other.txHash, txHash) || other.txHash == txHash)&&(identical(other.metadataUri, metadataUri) || other.metadataUri == metadataUri)&&(identical(other.blockExplorerUrl, blockExplorerUrl) || other.blockExplorerUrl == blockExplorerUrl)&&(identical(other.chain, chain) || other.chain == chain)&&(identical(other.contractAddress, contractAddress) || other.contractAddress == contractAddress));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,tokenId,txHash,metadataUri,blockExplorerUrl,chain,contractAddress);

@override
String toString() {
  return 'MintResult(tokenId: $tokenId, txHash: $txHash, metadataUri: $metadataUri, blockExplorerUrl: $blockExplorerUrl, chain: $chain, contractAddress: $contractAddress)';
}


}

/// @nodoc
abstract mixin class $MintResultCopyWith<$Res>  {
  factory $MintResultCopyWith(MintResult value, $Res Function(MintResult) _then) = _$MintResultCopyWithImpl;
@useResult
$Res call({
 String tokenId, String txHash, String metadataUri, String blockExplorerUrl, String chain, String contractAddress
});




}
/// @nodoc
class _$MintResultCopyWithImpl<$Res>
    implements $MintResultCopyWith<$Res> {
  _$MintResultCopyWithImpl(this._self, this._then);

  final MintResult _self;
  final $Res Function(MintResult) _then;

/// Create a copy of MintResult
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? tokenId = null,Object? txHash = null,Object? metadataUri = null,Object? blockExplorerUrl = null,Object? chain = null,Object? contractAddress = null,}) {
  return _then(_self.copyWith(
tokenId: null == tokenId ? _self.tokenId : tokenId // ignore: cast_nullable_to_non_nullable
as String,txHash: null == txHash ? _self.txHash : txHash // ignore: cast_nullable_to_non_nullable
as String,metadataUri: null == metadataUri ? _self.metadataUri : metadataUri // ignore: cast_nullable_to_non_nullable
as String,blockExplorerUrl: null == blockExplorerUrl ? _self.blockExplorerUrl : blockExplorerUrl // ignore: cast_nullable_to_non_nullable
as String,chain: null == chain ? _self.chain : chain // ignore: cast_nullable_to_non_nullable
as String,contractAddress: null == contractAddress ? _self.contractAddress : contractAddress // ignore: cast_nullable_to_non_nullable
as String,
  ));
}

}


/// Adds pattern-matching-related methods to [MintResult].
extension MintResultPatterns on MintResult {
/// A variant of `map` that fallback to returning `orElse`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _MintResult value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _MintResult() when $default != null:
return $default(_that);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// Callbacks receives the raw object, upcasted.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case final Subclass2 value:
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _MintResult value)  $default,){
final _that = this;
switch (_that) {
case _MintResult():
return $default(_that);case _:
  throw StateError('Unexpected subclass');

}
}
/// A variant of `map` that fallback to returning `null`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _MintResult value)?  $default,){
final _that = this;
switch (_that) {
case _MintResult() when $default != null:
return $default(_that);case _:
  return null;

}
}
/// A variant of `when` that fallback to an `orElse` callback.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String tokenId,  String txHash,  String metadataUri,  String blockExplorerUrl,  String chain,  String contractAddress)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _MintResult() when $default != null:
return $default(_that.tokenId,_that.txHash,_that.metadataUri,_that.blockExplorerUrl,_that.chain,_that.contractAddress);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// As opposed to `map`, this offers destructuring.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case Subclass2(:final field2):
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String tokenId,  String txHash,  String metadataUri,  String blockExplorerUrl,  String chain,  String contractAddress)  $default,) {final _that = this;
switch (_that) {
case _MintResult():
return $default(_that.tokenId,_that.txHash,_that.metadataUri,_that.blockExplorerUrl,_that.chain,_that.contractAddress);case _:
  throw StateError('Unexpected subclass');

}
}
/// A variant of `when` that fallback to returning `null`
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String tokenId,  String txHash,  String metadataUri,  String blockExplorerUrl,  String chain,  String contractAddress)?  $default,) {final _that = this;
switch (_that) {
case _MintResult() when $default != null:
return $default(_that.tokenId,_that.txHash,_that.metadataUri,_that.blockExplorerUrl,_that.chain,_that.contractAddress);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _MintResult implements MintResult {
  const _MintResult({required this.tokenId, required this.txHash, required this.metadataUri, required this.blockExplorerUrl, required this.chain, required this.contractAddress});
  factory _MintResult.fromJson(Map<String, dynamic> json) => _$MintResultFromJson(json);

@override final  String tokenId;
@override final  String txHash;
@override final  String metadataUri;
@override final  String blockExplorerUrl;
@override final  String chain;
@override final  String contractAddress;

/// Create a copy of MintResult
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$MintResultCopyWith<_MintResult> get copyWith => __$MintResultCopyWithImpl<_MintResult>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$MintResultToJson(this, );
}

@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _MintResult&&(identical(other.tokenId, tokenId) || other.tokenId == tokenId)&&(identical(other.txHash, txHash) || other.txHash == txHash)&&(identical(other.metadataUri, metadataUri) || other.metadataUri == metadataUri)&&(identical(other.blockExplorerUrl, blockExplorerUrl) || other.blockExplorerUrl == blockExplorerUrl)&&(identical(other.chain, chain) || other.chain == chain)&&(identical(other.contractAddress, contractAddress) || other.contractAddress == contractAddress));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,tokenId,txHash,metadataUri,blockExplorerUrl,chain,contractAddress);

@override
String toString() {
  return 'MintResult(tokenId: $tokenId, txHash: $txHash, metadataUri: $metadataUri, blockExplorerUrl: $blockExplorerUrl, chain: $chain, contractAddress: $contractAddress)';
}


}

/// @nodoc
abstract mixin class _$MintResultCopyWith<$Res> implements $MintResultCopyWith<$Res> {
  factory _$MintResultCopyWith(_MintResult value, $Res Function(_MintResult) _then) = __$MintResultCopyWithImpl;
@override @useResult
$Res call({
 String tokenId, String txHash, String metadataUri, String blockExplorerUrl, String chain, String contractAddress
});




}
/// @nodoc
class __$MintResultCopyWithImpl<$Res>
    implements _$MintResultCopyWith<$Res> {
  __$MintResultCopyWithImpl(this._self, this._then);

  final _MintResult _self;
  final $Res Function(_MintResult) _then;

/// Create a copy of MintResult
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? tokenId = null,Object? txHash = null,Object? metadataUri = null,Object? blockExplorerUrl = null,Object? chain = null,Object? contractAddress = null,}) {
  return _then(_MintResult(
tokenId: null == tokenId ? _self.tokenId : tokenId // ignore: cast_nullable_to_non_nullable
as String,txHash: null == txHash ? _self.txHash : txHash // ignore: cast_nullable_to_non_nullable
as String,metadataUri: null == metadataUri ? _self.metadataUri : metadataUri // ignore: cast_nullable_to_non_nullable
as String,blockExplorerUrl: null == blockExplorerUrl ? _self.blockExplorerUrl : blockExplorerUrl // ignore: cast_nullable_to_non_nullable
as String,chain: null == chain ? _self.chain : chain // ignore: cast_nullable_to_non_nullable
as String,contractAddress: null == contractAddress ? _self.contractAddress : contractAddress // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

// dart format on
