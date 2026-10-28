import '../../core/config/app_version.dart';
import '../../core/network/api_client.dart';

/// `GET /app-config`: the minimum app version per platform and where to update.
class ServerAppConfig {
  const ServerAppConfig({this.minIos, this.minAndroid, this.updateUrlIos, this.updateUrlAndroid});

  final AppVersion? minIos;
  final AppVersion? minAndroid;
  final Uri? updateUrlIos;
  final Uri? updateUrlAndroid;

  /// Unknown or malformed fields are dropped (never a lock-out by mistake:
  /// the server's own check on every request is what enforces the minimum).
  factory ServerAppConfig.fromJson(Map<String, dynamic> json) {
    Map<String, dynamic> map(Object? v) => v is Map<String, dynamic> ? v : const {};
    Uri? https(Object? v) {
      if (v is! String) return null;
      final u = Uri.tryParse(v);
      return u != null && u.scheme == 'https' ? u : null;
    }

    final min = map(json['minVersion']);
    final url = map(json['updateUrl']);
    return ServerAppConfig(
      minIos: AppVersion.tryParse(min['ios'] as String?),
      minAndroid: AppVersion.tryParse(min['android'] as String?),
      updateUrlIos: https(url['ios']),
      updateUrlAndroid: https(url['android']),
    );
  }

  AppVersion? minFor(String platform) => platform == 'ios' ? minIos : minAndroid;
  Uri? updateUrlFor(String platform) => platform == 'ios' ? updateUrlIos : updateUrlAndroid;
}

sealed class UpdateState {
  const UpdateState();
}

class UpdateChecking extends UpdateState {
  const UpdateChecking();
}

class UpdateOk extends UpdateState {
  const UpdateOk();
}

class UpdateRequired extends UpdateState {
  const UpdateRequired({this.updateUrl});
  final Uri? updateUrl;
}

/// True when this build is older than the server's minimum for its platform.
bool isBelowMinimum(ServerAppConfig config, ClientInfo client) {
  final current = AppVersion.tryParse(client.version);
  final min = config.minFor(client.platform);
  if (current == null || min == null) return false;
  return current < min;
}

/// Asks the server once at start-up. A network failure lets the app start:
/// the server refuses old versions on every request anyway (426,
/// `app_update_required`), which also lands here through [ApiClient].
Future<UpdateState> checkForUpdate(ApiClient api, ClientInfo client) async {
  try {
    final config = ServerAppConfig.fromJson(await api.get('/app-config'));
    return isBelowMinimum(config, client)
        ? UpdateRequired(updateUrl: config.updateUrlFor(client.platform))
        : const UpdateOk();
  } on ApiException catch (e) {
    if (e.updateRequired) return const UpdateRequired();
    return const UpdateOk();
  }
}
