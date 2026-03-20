// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'registration_wizard_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;
/// @nodoc
mixin _$RegistrationWizardState {





@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is RegistrationWizardState);
}


@override
int get hashCode => runtimeType.hashCode;

@override
String toString() {
  return 'RegistrationWizardState()';
}


}

/// @nodoc
class $RegistrationWizardStateCopyWith<$Res>  {
$RegistrationWizardStateCopyWith(RegistrationWizardState _, $Res Function(RegistrationWizardState) __);
}


/// Adds pattern-matching-related methods to [RegistrationWizardState].
extension RegistrationWizardStatePatterns on RegistrationWizardState {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>({TResult Function( _SelectListing value)?  selectListing,TResult Function( _ScanTag value)?  scanTag,TResult Function( _EnterKey value)?  enterKey,TResult Function( _Confirming value)?  confirming,TResult Function( _Success value)?  success,TResult Function( _Error value)?  error,required TResult orElse(),}){
final _that = this;
switch (_that) {
case _SelectListing() when selectListing != null:
return selectListing(_that);case _ScanTag() when scanTag != null:
return scanTag(_that);case _EnterKey() when enterKey != null:
return enterKey(_that);case _Confirming() when confirming != null:
return confirming(_that);case _Success() when success != null:
return success(_that);case _Error() when error != null:
return error(_that);case _:
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

@optionalTypeArgs TResult map<TResult extends Object?>({required TResult Function( _SelectListing value)  selectListing,required TResult Function( _ScanTag value)  scanTag,required TResult Function( _EnterKey value)  enterKey,required TResult Function( _Confirming value)  confirming,required TResult Function( _Success value)  success,required TResult Function( _Error value)  error,}){
final _that = this;
switch (_that) {
case _SelectListing():
return selectListing(_that);case _ScanTag():
return scanTag(_that);case _EnterKey():
return enterKey(_that);case _Confirming():
return confirming(_that);case _Success():
return success(_that);case _Error():
return error(_that);}
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>({TResult? Function( _SelectListing value)?  selectListing,TResult? Function( _ScanTag value)?  scanTag,TResult? Function( _EnterKey value)?  enterKey,TResult? Function( _Confirming value)?  confirming,TResult? Function( _Success value)?  success,TResult? Function( _Error value)?  error,}){
final _that = this;
switch (_that) {
case _SelectListing() when selectListing != null:
return selectListing(_that);case _ScanTag() when scanTag != null:
return scanTag(_that);case _EnterKey() when enterKey != null:
return enterKey(_that);case _Confirming() when confirming != null:
return confirming(_that);case _Success() when success != null:
return success(_that);case _Error() when error != null:
return error(_that);case _:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>({TResult Function()?  selectListing,TResult Function( String listingId,  String listingTitle)?  scanTag,TResult Function( String listingId,  String listingTitle,  String tagUid)?  enterKey,TResult Function( String listingId,  String listingTitle,  String tagUid,  String aesKey)?  confirming,TResult Function( RegistrationResult result)?  success,TResult Function( String message)?  error,required TResult orElse(),}) {final _that = this;
switch (_that) {
case _SelectListing() when selectListing != null:
return selectListing();case _ScanTag() when scanTag != null:
return scanTag(_that.listingId,_that.listingTitle);case _EnterKey() when enterKey != null:
return enterKey(_that.listingId,_that.listingTitle,_that.tagUid);case _Confirming() when confirming != null:
return confirming(_that.listingId,_that.listingTitle,_that.tagUid,_that.aesKey);case _Success() when success != null:
return success(_that.result);case _Error() when error != null:
return error(_that.message);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>({required TResult Function()  selectListing,required TResult Function( String listingId,  String listingTitle)  scanTag,required TResult Function( String listingId,  String listingTitle,  String tagUid)  enterKey,required TResult Function( String listingId,  String listingTitle,  String tagUid,  String aesKey)  confirming,required TResult Function( RegistrationResult result)  success,required TResult Function( String message)  error,}) {final _that = this;
switch (_that) {
case _SelectListing():
return selectListing();case _ScanTag():
return scanTag(_that.listingId,_that.listingTitle);case _EnterKey():
return enterKey(_that.listingId,_that.listingTitle,_that.tagUid);case _Confirming():
return confirming(_that.listingId,_that.listingTitle,_that.tagUid,_that.aesKey);case _Success():
return success(_that.result);case _Error():
return error(_that.message);}
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>({TResult? Function()?  selectListing,TResult? Function( String listingId,  String listingTitle)?  scanTag,TResult? Function( String listingId,  String listingTitle,  String tagUid)?  enterKey,TResult? Function( String listingId,  String listingTitle,  String tagUid,  String aesKey)?  confirming,TResult? Function( RegistrationResult result)?  success,TResult? Function( String message)?  error,}) {final _that = this;
switch (_that) {
case _SelectListing() when selectListing != null:
return selectListing();case _ScanTag() when scanTag != null:
return scanTag(_that.listingId,_that.listingTitle);case _EnterKey() when enterKey != null:
return enterKey(_that.listingId,_that.listingTitle,_that.tagUid);case _Confirming() when confirming != null:
return confirming(_that.listingId,_that.listingTitle,_that.tagUid,_that.aesKey);case _Success() when success != null:
return success(_that.result);case _Error() when error != null:
return error(_that.message);case _:
  return null;

}
}

}

/// @nodoc


class _SelectListing implements RegistrationWizardState {
  const _SelectListing();
  






@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _SelectListing);
}


@override
int get hashCode => runtimeType.hashCode;

@override
String toString() {
  return 'RegistrationWizardState.selectListing()';
}


}




/// @nodoc


class _ScanTag implements RegistrationWizardState {
  const _ScanTag({required this.listingId, required this.listingTitle});
  

 final  String listingId;
 final  String listingTitle;

/// Create a copy of RegistrationWizardState
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$ScanTagCopyWith<_ScanTag> get copyWith => __$ScanTagCopyWithImpl<_ScanTag>(this, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _ScanTag&&(identical(other.listingId, listingId) || other.listingId == listingId)&&(identical(other.listingTitle, listingTitle) || other.listingTitle == listingTitle));
}


@override
int get hashCode => Object.hash(runtimeType,listingId,listingTitle);

@override
String toString() {
  return 'RegistrationWizardState.scanTag(listingId: $listingId, listingTitle: $listingTitle)';
}


}

/// @nodoc
abstract mixin class _$ScanTagCopyWith<$Res> implements $RegistrationWizardStateCopyWith<$Res> {
  factory _$ScanTagCopyWith(_ScanTag value, $Res Function(_ScanTag) _then) = __$ScanTagCopyWithImpl;
@useResult
$Res call({
 String listingId, String listingTitle
});




}
/// @nodoc
class __$ScanTagCopyWithImpl<$Res>
    implements _$ScanTagCopyWith<$Res> {
  __$ScanTagCopyWithImpl(this._self, this._then);

  final _ScanTag _self;
  final $Res Function(_ScanTag) _then;

/// Create a copy of RegistrationWizardState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? listingId = null,Object? listingTitle = null,}) {
  return _then(_ScanTag(
listingId: null == listingId ? _self.listingId : listingId // ignore: cast_nullable_to_non_nullable
as String,listingTitle: null == listingTitle ? _self.listingTitle : listingTitle // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

/// @nodoc


class _EnterKey implements RegistrationWizardState {
  const _EnterKey({required this.listingId, required this.listingTitle, required this.tagUid});
  

 final  String listingId;
 final  String listingTitle;
 final  String tagUid;

/// Create a copy of RegistrationWizardState
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$EnterKeyCopyWith<_EnterKey> get copyWith => __$EnterKeyCopyWithImpl<_EnterKey>(this, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _EnterKey&&(identical(other.listingId, listingId) || other.listingId == listingId)&&(identical(other.listingTitle, listingTitle) || other.listingTitle == listingTitle)&&(identical(other.tagUid, tagUid) || other.tagUid == tagUid));
}


@override
int get hashCode => Object.hash(runtimeType,listingId,listingTitle,tagUid);

@override
String toString() {
  return 'RegistrationWizardState.enterKey(listingId: $listingId, listingTitle: $listingTitle, tagUid: $tagUid)';
}


}

/// @nodoc
abstract mixin class _$EnterKeyCopyWith<$Res> implements $RegistrationWizardStateCopyWith<$Res> {
  factory _$EnterKeyCopyWith(_EnterKey value, $Res Function(_EnterKey) _then) = __$EnterKeyCopyWithImpl;
@useResult
$Res call({
 String listingId, String listingTitle, String tagUid
});




}
/// @nodoc
class __$EnterKeyCopyWithImpl<$Res>
    implements _$EnterKeyCopyWith<$Res> {
  __$EnterKeyCopyWithImpl(this._self, this._then);

  final _EnterKey _self;
  final $Res Function(_EnterKey) _then;

/// Create a copy of RegistrationWizardState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? listingId = null,Object? listingTitle = null,Object? tagUid = null,}) {
  return _then(_EnterKey(
listingId: null == listingId ? _self.listingId : listingId // ignore: cast_nullable_to_non_nullable
as String,listingTitle: null == listingTitle ? _self.listingTitle : listingTitle // ignore: cast_nullable_to_non_nullable
as String,tagUid: null == tagUid ? _self.tagUid : tagUid // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

/// @nodoc


class _Confirming implements RegistrationWizardState {
  const _Confirming({required this.listingId, required this.listingTitle, required this.tagUid, required this.aesKey});
  

 final  String listingId;
 final  String listingTitle;
 final  String tagUid;
 final  String aesKey;

/// Create a copy of RegistrationWizardState
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$ConfirmingCopyWith<_Confirming> get copyWith => __$ConfirmingCopyWithImpl<_Confirming>(this, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _Confirming&&(identical(other.listingId, listingId) || other.listingId == listingId)&&(identical(other.listingTitle, listingTitle) || other.listingTitle == listingTitle)&&(identical(other.tagUid, tagUid) || other.tagUid == tagUid)&&(identical(other.aesKey, aesKey) || other.aesKey == aesKey));
}


@override
int get hashCode => Object.hash(runtimeType,listingId,listingTitle,tagUid,aesKey);

@override
String toString() {
  return 'RegistrationWizardState.confirming(listingId: $listingId, listingTitle: $listingTitle, tagUid: $tagUid, aesKey: $aesKey)';
}


}

/// @nodoc
abstract mixin class _$ConfirmingCopyWith<$Res> implements $RegistrationWizardStateCopyWith<$Res> {
  factory _$ConfirmingCopyWith(_Confirming value, $Res Function(_Confirming) _then) = __$ConfirmingCopyWithImpl;
@useResult
$Res call({
 String listingId, String listingTitle, String tagUid, String aesKey
});




}
/// @nodoc
class __$ConfirmingCopyWithImpl<$Res>
    implements _$ConfirmingCopyWith<$Res> {
  __$ConfirmingCopyWithImpl(this._self, this._then);

  final _Confirming _self;
  final $Res Function(_Confirming) _then;

/// Create a copy of RegistrationWizardState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? listingId = null,Object? listingTitle = null,Object? tagUid = null,Object? aesKey = null,}) {
  return _then(_Confirming(
listingId: null == listingId ? _self.listingId : listingId // ignore: cast_nullable_to_non_nullable
as String,listingTitle: null == listingTitle ? _self.listingTitle : listingTitle // ignore: cast_nullable_to_non_nullable
as String,tagUid: null == tagUid ? _self.tagUid : tagUid // ignore: cast_nullable_to_non_nullable
as String,aesKey: null == aesKey ? _self.aesKey : aesKey // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

/// @nodoc


class _Success implements RegistrationWizardState {
  const _Success(this.result);
  

 final  RegistrationResult result;

/// Create a copy of RegistrationWizardState
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$SuccessCopyWith<_Success> get copyWith => __$SuccessCopyWithImpl<_Success>(this, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _Success&&(identical(other.result, result) || other.result == result));
}


@override
int get hashCode => Object.hash(runtimeType,result);

@override
String toString() {
  return 'RegistrationWizardState.success(result: $result)';
}


}

/// @nodoc
abstract mixin class _$SuccessCopyWith<$Res> implements $RegistrationWizardStateCopyWith<$Res> {
  factory _$SuccessCopyWith(_Success value, $Res Function(_Success) _then) = __$SuccessCopyWithImpl;
@useResult
$Res call({
 RegistrationResult result
});


$RegistrationResultCopyWith<$Res> get result;

}
/// @nodoc
class __$SuccessCopyWithImpl<$Res>
    implements _$SuccessCopyWith<$Res> {
  __$SuccessCopyWithImpl(this._self, this._then);

  final _Success _self;
  final $Res Function(_Success) _then;

/// Create a copy of RegistrationWizardState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? result = null,}) {
  return _then(_Success(
null == result ? _self.result : result // ignore: cast_nullable_to_non_nullable
as RegistrationResult,
  ));
}

/// Create a copy of RegistrationWizardState
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$RegistrationResultCopyWith<$Res> get result {
  
  return $RegistrationResultCopyWith<$Res>(_self.result, (value) {
    return _then(_self.copyWith(result: value));
  });
}
}

/// @nodoc


class _Error implements RegistrationWizardState {
  const _Error(this.message);
  

 final  String message;

/// Create a copy of RegistrationWizardState
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$ErrorCopyWith<_Error> get copyWith => __$ErrorCopyWithImpl<_Error>(this, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _Error&&(identical(other.message, message) || other.message == message));
}


@override
int get hashCode => Object.hash(runtimeType,message);

@override
String toString() {
  return 'RegistrationWizardState.error(message: $message)';
}


}

/// @nodoc
abstract mixin class _$ErrorCopyWith<$Res> implements $RegistrationWizardStateCopyWith<$Res> {
  factory _$ErrorCopyWith(_Error value, $Res Function(_Error) _then) = __$ErrorCopyWithImpl;
@useResult
$Res call({
 String message
});




}
/// @nodoc
class __$ErrorCopyWithImpl<$Res>
    implements _$ErrorCopyWith<$Res> {
  __$ErrorCopyWithImpl(this._self, this._then);

  final _Error _self;
  final $Res Function(_Error) _then;

/// Create a copy of RegistrationWizardState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? message = null,}) {
  return _then(_Error(
null == message ? _self.message : message // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

// dart format on
