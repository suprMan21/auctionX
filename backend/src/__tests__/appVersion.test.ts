import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { appConfigPayload, checkAppVersion, compareVersions, parseVersion } from '../lib/appVersion';

/**
 * S-MOB1: Creator-app minimum version.
 *  - GET /api/v1/app-config is public and carries versions + https links only.
 *  - The gate refuses app requests below the minimum (426 app_update_required)
 *    and never touches requests without the app's headers (the website).
 */

const ENV_KEYS = ['APP_MIN_VERSION_IOS', 'APP_MIN_VERSION_ANDROID', 'APP_UPDATE_URL_IOS', 'APP_UPDATE_URL_ANDROID'];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const loadApp = async () => {
  vi.resetModules();
  const { createApp } = await import('../app');
  return createApp();
};

describe('version parsing', () => {
  it('reads x.y.z and drops a build suffix', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion('0.1.0+5')).toEqual({ major: 0, minor: 1, patch: 0 });
  });

  it('rejects anything else', () => {
    for (const bad of [undefined, null, 1, '', '1.2', '1.2.3.4', 'v1.2.3', '1.2.x', '12345.0.0']) {
      expect(parseVersion(bad)).toBeNull();
    }
  });

  it('compares numerically', () => {
    expect(compareVersions(parseVersion('0.9.0')!, parseVersion('0.10.0')!)).toBeLessThan(0);
    expect(compareVersions(parseVersion('1.0.0')!, parseVersion('0.99.99')!)).toBeGreaterThan(0);
    expect(compareVersions(parseVersion('1.2.3')!, parseVersion('1.2.3')!)).toBe(0);
  });
});

describe('checkAppVersion', () => {
  it('no app headers → not the app', () => {
    expect(checkAppVersion(undefined, undefined)).toBe('not_app');
    expect(checkAppVersion('', '')).toBe('not_app');
  });

  it('no minimum set → any valid app passes', () => {
    expect(checkAppVersion('0.0.1', 'ios')).toBe('ok');
    expect(checkAppVersion('0.0.1', 'android')).toBe('ok');
  });

  it('below / at / above the minimum, per platform', () => {
    process.env.APP_MIN_VERSION_IOS = '0.2.0';
    process.env.APP_MIN_VERSION_ANDROID = '0.1.0';
    expect(checkAppVersion('0.1.9', 'ios')).toBe('update_required');
    expect(checkAppVersion('0.2.0', 'ios')).toBe('ok');
    expect(checkAppVersion('0.3.0', 'ios')).toBe('ok');
    expect(checkAppVersion('0.1.9', 'android')).toBe('ok');
  });

  it('a half-sent or malformed pair is refused, never waved through', () => {
    expect(checkAppVersion('0.2.0', undefined)).toBe('update_required');
    expect(checkAppVersion(undefined, 'ios')).toBe('update_required');
    expect(checkAppVersion('banana', 'ios')).toBe('update_required');
    expect(checkAppVersion('0.2.0', 'windows')).toBe('update_required');
  });

  it('a malformed minimum in env means no minimum (a typo never locks everyone out)', () => {
    process.env.APP_MIN_VERSION_IOS = '1.0';
    expect(checkAppVersion('0.0.1', 'ios')).toBe('ok');
  });
});

describe('appConfigPayload', () => {
  it('defaults to 0.0.0 and no links', () => {
    expect(appConfigPayload()).toEqual({ minVersion: { ios: '0.0.0', android: '0.0.0' }, updateUrl: {} });
  });

  it('keeps https links only', () => {
    process.env.APP_UPDATE_URL_IOS = 'https://testflight.apple.com/join/abc';
    process.env.APP_UPDATE_URL_ANDROID = 'http://play.google.com/x';
    expect(appConfigPayload().updateUrl).toEqual({ ios: 'https://testflight.apple.com/join/abc' });
  });
});

describe('GET /api/v1/app-config (through the real app)', () => {
  it('is public and returns versions + links only (no private fields)', async () => {
    process.env.APP_MIN_VERSION_IOS = '0.2.0';
    process.env.APP_UPDATE_URL_IOS = 'https://testflight.apple.com/join/abc';
    const res = await request(await loadApp()).get('/api/v1/app-config');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      success: true,
      error: null,
      data: { minVersion: { ios: '0.2.0', android: '0.0.0' }, updateUrl: { ios: 'https://testflight.apple.com/join/abc' } },
    });
    const text = JSON.stringify(res.body);
    for (const leak of ['email', 'user', 'ip', 'uid', 'secret', 'key', 'token']) {
      expect(text.toLowerCase()).not.toContain(`"${leak}`);
    }
  });

  it('an out-of-date app can still read it', async () => {
    process.env.APP_MIN_VERSION_IOS = '9.0.0';
    const res = await request(await loadApp())
      .get('/api/v1/app-config')
      .set('X-App-Version', '0.1.0')
      .set('X-App-Platform', 'ios');
    expect(res.status).toBe(200);
    expect(res.body.data.minVersion.ios).toBe('9.0.0');
  });
});

describe('appVersionGate (through the real app)', () => {
  // Any gated token route will do: the gate answers before the route's own auth.
  const PATH = '/api/v1/auth/mfa/status';

  it('refuses an old app with 426 app_update_required', async () => {
    process.env.APP_MIN_VERSION_ANDROID = '0.2.0';
    const res = await request(await loadApp()).get(PATH).set('X-App-Version', '0.1.0').set('X-App-Platform', 'android');
    expect(res.status).toBe(426);
    expect(res.body).toMatchObject({ success: false, reason: 'app_update_required' });
  });

  it('lets a current app through to the route (which then wants a sign-in)', async () => {
    process.env.APP_MIN_VERSION_ANDROID = '0.2.0';
    const res = await request(await loadApp()).get(PATH).set('X-App-Version', '0.2.0').set('X-App-Platform', 'android');
    expect(res.status).not.toBe(426);
    expect(res.status).toBe(401);
  });

  it('never touches the website (no app headers)', async () => {
    process.env.APP_MIN_VERSION_IOS = '9.0.0';
    process.env.APP_MIN_VERSION_ANDROID = '9.0.0';
    const res = await request(await loadApp()).get(PATH);
    expect(res.status).toBe(401);
  });

  it('health stays reachable for any version', async () => {
    process.env.APP_MIN_VERSION_IOS = '9.0.0';
    const res = await request(await loadApp()).get('/api/v1/health').set('X-App-Version', '0.1.0').set('X-App-Platform', 'ios');
    expect(res.status).toBe(200);
  });
});
