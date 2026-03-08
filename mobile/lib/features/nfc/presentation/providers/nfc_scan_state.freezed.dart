// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'nfc_scan_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;
/// @nodoc
mixin _$NfcScanState {





@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is NfcScanState);
}


@override
int get hashCode => runtimeType.hashCode;

@override
String toString() {
  return 'NfcScanState()';
}


}

/// @nodoc
class $NfcScanStateCopyWith<$Res>  {
$NfcScanStateCopyWith(NfcScanState _, $Res Function(NfcScanState) __);
}


/// Adds pattern-matching-related methods to [NfcScanState].
extension NfcScanStatePatterns on NfcScanState {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>({TResult Function( _Idle value)?  idle,TResult Function( _Checking value)?  checking,TResult Function( _Scanning value)?  scanning,TResult Function( _Reading value)?  reading,TResult Function( _Validating value)?  validating,TResult Function( _Verified value)?  verified,TResult Function( _Invalid value)?  invalid,TResult Function( _SavedOffline value)?  savedOffline,TResult Function( _Error value)?  error,TResult Function( _Unavailable value)?  unavailable,required TResult orElse(),}){
final _that = this;
switch (_that) {
case _Idle() when idle != null:
return idle(_that);case _Checking() when checking != null:
return checking(_that);case _Scanning() when scanning != null:
return scanning(_that);case _Reading() when reading != null:
return reading(_that);case _Validating() when validating != null:
return validating(_that);case _Verified() when verified != null:
return verified(_that);case _Invalid() when invalid != null:
return invalid(_that);case _SavedOffline() when savedOffline != null:
return savedOffline(_that);case _Error() when error != null:
return error(_that);case _Unavailable() when unavailable != null:
return unavailable(_that);case _:
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

@optionalTypeArgs TResult map<TResult extends Object?>({required TResult Function( _Idle value)  idle,required TResult Function( _Checking value)  checking,required TResult Function( _Scanning value)  scanning,required TResult Function( _Reading value)  reading,required TResult Function( _Validating value)  validating,required TResult Function( _Verified value)  verified,required TResult Function( _Invalid value)  invalid,required TResult Function( _SavedOffline value)  savedOffline,required TResult Function( _Error value)  error,required TResult Function( _Unavailable value)  unavailable,}){
final _that = this;
switch (_that) {
case _Idle():
return idle(_that);case _Checking():
return checking(_that);case _Scanning():
return scanning(_that);case _Reading():
return reading(_that);case _Validating():
return validating(_that);case _Verified():
return verified(_that);case _Invalid():
return invalid(_that);case _SavedOffline():
return savedOffline(_that);case _Error():
return error(_that);case _Unavailable():
return unavailable(_that);}
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>({TResult? Function( _Idle value)?  idle,TResult? Function( _Checking value)?  checking,TResult? Function( _Scanning value)?  scanning,TResult? Function( _Reading value)?  reading,TResult? Function( _Validating value)?  validating,TResult? Function( _Verified value)?  verified,TResult? Function( _Invalid value)?  invalid,TResult? Function( _SavedOffline value)?  savedOffline,TResult? Function( _Error value)?  error,TResult? Function( _Unavailable value)?  unavailable,}){
final _that = this;
switch (_that) {
case _Idle() when idle != null:
return idle(_that);case _Checking() when checking != null:
return checking(_that);case _Scanning() when scanning != null:
return scanning(_that);case _Reading() when reading != null:
return reading(_that);case _Validating() when validating != null:
return validating(_that);case _Verified() when verified != null:
return verified(_that);case _Invalid() when invalid != null:
return invalid(_that);case _SavedOffline() when savedOffline != null:
return savedOffline(_that);case _Error() when error != null:
return error(_that);case _Unavailable() when unavailable != null:
return unavailable(_that);case _:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>({TResult Function()?  idle,TResult Function()?  checking,TResult Function()?  scanning,TResult Function()?  reading,TResult Function()?  validating,TResult Function( ScanResult result,  TagDetail? detail)?  verified,TResult Function( ScanResult result)?  invalid,TResult Function()?  savedOffline,TResult Function( String message)?  error,TResult Function()?  unavailable,required TResult orElse(),}) {final _that = this;
switch (_that) {
case _Idle() when idle != null:
return idle();case _Checking() when checking != null:
return checking();case _Scanning() when scanning != null:
return scanning();case _Reading() when reading != null:
return reading();case _Validating() when validating != null:
return validating();case _Verified() when verified != null:
return verified(_that.result,_that.detail);case _Invalid() when invalid != null:
return invalid(_that.result);case _SavedOffline() when savedOffline != null:
return savedOffline();case _Error() when error != null:
return error(_that.message);case _Unavailable() when unavailable != null:
return unavailable();case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>({required TResult Function()  idle,required TResult Function()  checking,required TResult Function()  scanning,required TResult Function()  reading,required TResult Function()  validating,required TResult Function( ScanResult result,  TagDetail? detail)  verified,required TResult Function( ScanResult result)  invalid,required TResult Function()  savedOffline,required TResult Function( String message)  error,required TResult Function()  unavailable,}) {final _that = this;
switch (_that) {
case _Idle():
return idle();case _Checking():
return checking();case _Scanning():
return scanning();case _Reading():
return reading();case _Validating():
return validating();case _Verified():
return verified(_that.result,_that.detail);case _Invalid():
return invalid(_that.result);case _SavedOffline():
return savedOffline();case _Error():
return error(_that.message);case _Unavailable():
return unavailable();}
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>({TResult? Function()?  idle,TResult? Function()?  checking,TResult? Function()?  scanning,TResult? Function()?  reading,TResult? Function()?  validating,TResult? Function( ScanResult result,  TagDetail? detail)?  verified,TResult? Function( ScanResult result)?  invalid,TResult? Function()?  savedOffline,TResult? Function( String message)?  error,TResult? Function()?  unavailable,}) {final _that = this;
switch (_that) {
case _Idle() when idle != null:
return idle();case _Checking() when checking != null:
return checking();case _Scanning() when scanning != null:
return scanning();case _Reading() when reading != null:
return reading();case _Validating() when validating != null:
return validating();case _Verified() when verified != null:
return verified(_that.result,_that.detail);case _Invalid() when invalid != null:
return invalid(_that.result);case _SavedOffline() when savedOffline != null:
return savedOffline();case _Error() when error != null:
return error(_that.message);case _Unavailable() when unavailable != null:
return unavailable();case _:
  return null;

}
}

}

/// @nodoc


class _Idle implements NfcScanState {
  const _Idle();
  






@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _Idle);
}


@override
int get hashCode => runtimeType.hashCode;

@override
String toString() {
  return 'NfcScanState.idle()';
}


}




/// @nodoc


class _Checking implements NfcScanState {
  const _Checking();
  






@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _Checking);
}


@override
int get hashCode => runtimeType.hashCode;

@override
String toString() {
  return 'NfcScanState.checking()';
}


}




/// @nodoc


class _Scanning implements NfcScanState {
  const _Scanning();
  






@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _Scanning);
}


@override
int get hashCode => runtimeType.hashCode;

@override
String toString() {
  return 'NfcScanState.scanning()';
}


}




/// @nodoc


class _Reading implements NfcScanState {
  const _Reading();
  






@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _Reading);
}


@override
int get hashCode => runtimeType.hashCode;

@override
String toString() {
  return 'NfcScanState.reading()';
}


}




/// @nodoc


class _Validating implements NfcScanState {
  const _Validating();
  






@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _Validating);
}


@override
int get hashCode => runtimeType.hashCode;

@override
String toString() {
  return 'NfcScanState.validating()';
}


}




/// @nodoc


class _Verified implements NfcScanState {
  const _Verified(this.result, {this.detail});
  

 final  ScanResult result;
 final  TagDetail? detail;

/// Create a copy of NfcScanState
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$VerifiedCopyWith<_Verified> get copyWith => __$VerifiedCopyWithImpl<_Verified>(this, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _Verified&&(identical(other.result, result) || other.result == result)&&(identical(other.detail, detail) || other.detail == detail));
}


@override
int get hashCode => Object.hash(runtimeType,result,detail);

@override
String toString() {
  return 'NfcScanState.verified(result: $result, detail: $detail)';
}


}

/// @nodoc
abstract mixin class _$VerifiedCopyWith<$Res> implements $NfcScanStateCopyWith<$Res> {
  factory _$VerifiedCopyWith(_Verified value, $Res Function(_Verified) _then) = __$VerifiedCopyWithImpl;
@useResult
$Res call({
 ScanResult result, TagDetail? detail
});


$ScanResultCopyWith<$Res> get result;$TagDetailCopyWith<$Res>? get detail;

}
/// @nodoc
class __$VerifiedCopyWithImpl<$Res>
    implements _$VerifiedCopyWith<$Res> {
  __$VerifiedCopyWithImpl(this._self, this._then);

  final _Verified _self;
  final $Res Function(_Verified) _then;

/// Create a copy of NfcScanState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? result = null,Object? detail = freezed,}) {
  return _then(_Verified(
null == result ? _self.result : result // ignore: cast_nullable_to_non_nullable
as ScanResult,detail: freezed == detail ? _self.detail : detail // ignore: cast_nullable_to_non_nullable
as TagDetail?,
  ));
}

/// Create a copy of NfcScanState
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$ScanResultCopyWith<$Res> get result {
  
  return $ScanResultCopyWith<$Res>(_self.result, (value) {
    return _then(_self.copyWith(result: value));
  });
}/// Create a copy of NfcScanState
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$TagDetailCopyWith<$Res>? get detail {
    if (_self.detail == null) {
    return null;
  }

  return $TagDetailCopyWith<$Res>(_self.detail!, (value) {
    return _then(_self.copyWith(detail: value));
  });
}
}

/// @nodoc


class _Invalid implements NfcScanState {
  const _Invalid(this.result);
  

 final  ScanResult result;

/// Create a copy of NfcScanState
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$InvalidCopyWith<_Invalid> get copyWith => __$InvalidCopyWithImpl<_Invalid>(this, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _Invalid&&(identical(other.result, result) || other.result == result));
}


@override
int get hashCode => Object.hash(runtimeType,result);

@override
String toString() {
  return 'NfcScanState.invalid(result: $result)';
}


}

/// @nodoc
abstract mixin class _$InvalidCopyWith<$Res> implements $NfcScanStateCopyWith<$Res> {
  factory _$InvalidCopyWith(_Invalid value, $Res Function(_Invalid) _then) = __$InvalidCopyWithImpl;
@useResult
$Res call({
 ScanResult result
});


$ScanResultCopyWith<$Res> get result;

}
/// @nodoc
class __$InvalidCopyWithImpl<$Res>
    implements _$InvalidCopyWith<$Res> {
  __$InvalidCopyWithImpl(this._self, this._then);

  final _Invalid _self;
  final $Res Function(_Invalid) _then;

/// Create a copy of NfcScanState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? result = null,}) {
  return _then(_Invalid(
null == result ? _self.result : result // ignore: cast_nullable_to_non_nullable
as ScanResult,
  ));
}

/// Create a copy of NfcScanState
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$ScanResultCopyWith<$Res> get result {
  
  return $ScanResultCopyWith<$Res>(_self.result, (value) {
    return _then(_self.copyWith(result: value));
  });
}
}

/// @nodoc


class _SavedOffline implements NfcScanState {
  const _SavedOffline();
  






@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _SavedOffline);
}


@override
int get hashCode => runtimeType.hashCode;

@override
String toString() {
  return 'NfcScanState.savedOffline()';
}


}




/// @nodoc


class _Error implements NfcScanState {
  const _Error(this.message);
  

 final  String message;

/// Create a copy of NfcScanState
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
  return 'NfcScanState.error(message: $message)';
}


}

/// @nodoc
abstract mixin class _$ErrorCopyWith<$Res> implements $NfcScanStateCopyWith<$Res> {
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

/// Create a copy of NfcScanState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? message = null,}) {
  return _then(_Error(
null == message ? _self.message : message // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

/// @nodoc


class _Unavailable implements NfcScanState {
  const _Unavailable();
  






@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _Unavailable);
}


@override
int get hashCode => runtimeType.hashCode;

@override
String toString() {
  return 'NfcScanState.unavailable()';
}


}




// dart format on
