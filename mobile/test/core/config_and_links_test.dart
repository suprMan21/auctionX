import 'dart:convert';
import 'dart:io';

import 'package:authentic_materials/core/config/app_config.dart';
import 'package:authentic_materials/core/config/app_version.dart';
import 'package:authentic_materials/core/links/web_links.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, String> good() => {
      'ENV': 'staging',
      'SUPABASE_URL': 'https://abc.supabase.co/',
      'SUPABASE_PUBLISHABLE_KEY': 'sb_publishable_x',
      'API_BASE_URL': 'https://api.example.com/api/v1',
      'WEB_BASE_URL': 'https://web.example.com/',
      'RP_ID': 'web.example.com',
    };

void main() {
  group('AppConfig', () {
    test('reads a full set and trims trailing slashes', () {
      final c = AppConfig.fromMap(good());
      expect(c.env, 'staging');
      expect(c.supabaseUrl, 'https://abc.supabase.co');
      expect(c.webBaseUrl, 'https://web.example.com');
      expect(c.webHost, 'web.example.com');
      expect(c.isProd, isFalse);
    });

    test('names every missing value', () {
      final m = good()..remove('API_BASE_URL')..['RP_ID'] = ' ';
      expect(
        () => AppConfig.fromMap(m),
        throwsA(isA<AppConfigError>().having((e) => e.message, 'message', allOf(contains('API_BASE_URL'), contains('RP_ID')))),
      );
    });

    test('refuses a non-https URL, an unknown env and an RP ID with a scheme', () {
      expect(() => AppConfig.fromMap(good()..['API_BASE_URL'] = 'http://api.example.com'), throwsA(isA<AppConfigError>()));
      expect(() => AppConfig.fromMap(good()..['ENV'] = 'dev'), throwsA(isA<AppConfigError>()));
      expect(() => AppConfig.fromMap(good()..['RP_ID'] = 'https://web.example.com'), throwsA(isA<AppConfigError>()));
    });

    test('the committed staging file is complete and valid', () {
      final raw = jsonDecode(File('env/staging.json').readAsStringSync()) as Map<String, dynamic>;
      final c = AppConfig.fromMap(raw.map((k, v) => MapEntry(k, v as String)));
      expect(c.env, 'staging');
      expect(c.rpId, c.webHost, reason: 'staging passkeys are bound to the web app host');
    });
  });

  group('AppVersion', () {
    test('parses x.y.z and drops a build suffix', () {
      expect(AppVersion.tryParse('1.2.3'), const AppVersion(1, 2, 3));
      expect(AppVersion.tryParse('0.1.0+5'), const AppVersion(0, 1, 0));
    });

    test('rejects anything else', () {
      for (final bad in [null, '', '1.2', '1.2.3.4', 'v1.2.3', '1.a.3', '99999.0.0']) {
        expect(AppVersion.tryParse(bad), isNull, reason: '$bad');
      }
    });

    test('compares numerically, not as text', () {
      expect(const AppVersion(0, 9, 0) < const AppVersion(0, 10, 0), isTrue);
      expect(const AppVersion(1, 0, 0) < const AppVersion(0, 99, 99), isFalse);
      expect(const AppVersion(1, 2, 3) < const AppVersion(1, 2, 3), isFalse);
    });
  });

  group('WebLinks', () {
    const links = WebLinks('https://web.example.com');

    test('every outgoing link carries from=app', () {
      for (final u in [links.signUp, links.forgotPassword, links.becomeCreator, links.recover]) {
        expect(u.host, 'web.example.com');
        expect(u.queryParameters, {'from': 'app'});
      }
      expect(links.signUp.path, '/register');
      expect(links.recover.path, '/sign-in/recover');
    });
  });

  group('parseIncomingLink', () {
    IncomingLink? parse(String s) => parseIncomingLink(Uri.parse(s), webHost: 'web.example.com');

    test('accepts /app/open on the web host, with or without a trailing slash', () {
      expect(parse('https://web.example.com/app/open'), isNotNull);
      expect(parse('https://web.example.com/app/open/'), isNotNull);
    });

    test('also accepts the public site (the web app links there to open the app)', () {
      expect(parse('https://authentic-materials.com/app/open?email=a%40b.co')!.emailHint, 'a@b.co');
      expect(parse('https://evil.authentic-materials.com/app/open'), isNull);
      expect(parse('https://authentic-materials.com.evil.com/app/open'), isNull);
      expect(parse('https://authentic-materials.com/'), isNull);
    });

    test('takes a valid email hint and nothing else', () {
      expect(parse('https://web.example.com/app/open?email=a%40b.co')!.emailHint, 'a@b.co');
      expect(parse('https://web.example.com/app/open?email=not-an-email')!.emailHint, isNull);
      expect(parse('https://web.example.com/app/open?next=https://evil.com')!.emailHint, isNull);
    });

    test('ignores other hosts, schemes and paths', () {
      expect(parse('https://evil.com/app/open'), isNull);
      expect(parse('https://web.example.com.evil.com/app/open'), isNull);
      expect(parse('http://web.example.com/app/open'), isNull);
      expect(parse('https://web.example.com/verify?picc_data=1'), isNull);
      expect(parse('https://web.example.com/app/open/../admin'), isNull);
      expect(parse('auctionx://verify'), isNull);
    });
  });
}
