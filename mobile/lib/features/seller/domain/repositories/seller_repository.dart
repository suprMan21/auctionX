import 'package:dartz/dartz.dart';
import '../../../../core/errors/failures.dart';
import '../entities/registration_result.dart';
import '../entities/seller_tag.dart';

abstract class SellerRepository {
  Future<Either<Failure, List<SellerTag>>> getSellerTags();
  Future<Either<Failure, RegistrationResult>> registerTag({
    required String tagUid,
    required String aesKey,
    required String itemId,
    required String tenantId,
  });
  Future<Either<Failure, List<Map<String, dynamic>>>> getSellerListings();
}
