import 'package:freezed_annotation/freezed_annotation.dart';
import '../../domain/entities/seller_tag.dart';

part 'seller_state.freezed.dart';

@freezed
sealed class SellerState with _$SellerState {
  const factory SellerState.initial() = _Initial;
  const factory SellerState.loading() = _Loading;
  const factory SellerState.loaded(List<SellerTag> tags) = _Loaded;
  const factory SellerState.error(String message) = _Error;
}
