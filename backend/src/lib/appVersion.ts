/**
 * S-MOB1: minimum Creator-app version per platform.
 *
 * The app sends `X-App-Version: x.y.z` and `X-App-Platform: ios|android` on
 * every request. Requests below the minimum are refused with reason
 * `app_update_required` (middleware/appVersionGate.ts). The website sends
 * neither header and is never affected.
 *
 * Env (read on use, so tests can set it per case):
 *   APP_MIN_VERSION_IOS / APP_MIN_VERSION_ANDROID   default 0.0.0 (no minimum)
 *   APP_UPDATE_URL_IOS / APP_UPDATE_URL_ANDROID     optional https store / TestFlight links
 */

export const APP_PLATFORMS = ['ios', 'android'] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];

export interface Version {
  major: number;
  minor: number;
  patch: number;
}

const VERSION_RE = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;

/** `x.y.z` only (a `+build` suffix is dropped); anything else is null. */
export const parseVersion = (raw: unknown): Version | null => {
  if (typeof raw !== 'string') return null;
  const m = VERSION_RE.exec(raw.split('+')[0].trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
};

export const compareVersions = (a: Version, b: Version): number =>
  a.major - b.major || a.minor - b.minor || a.patch - b.patch;

export const formatVersion = (v: Version): string => `${v.major}.${v.minor}.${v.patch}`;

export const isAppPlatform = (raw: unknown): raw is AppPlatform =>
  typeof raw === 'string' && (APP_PLATFORMS as readonly string[]).includes(raw);

const ZERO: Version = { major: 0, minor: 0, patch: 0 };

/** A malformed env value counts as no minimum, so a typo can never lock everyone out. */
export const minVersionFor = (platform: AppPlatform): Version =>
  parseVersion(process.env[platform === 'ios' ? 'APP_MIN_VERSION_IOS' : 'APP_MIN_VERSION_ANDROID']) ?? ZERO;

const httpsUrl = (raw: string | undefined): string | undefined => {
  if (!raw) return undefined;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
};

export interface AppConfigPayload {
  minVersion: Record<AppPlatform, string>;
  updateUrl: Partial<Record<AppPlatform, string>>;
}

/** Public payload for GET /api/v1/app-config. Versions and store links only. */
export const appConfigPayload = (): AppConfigPayload => {
  const updateUrl: Partial<Record<AppPlatform, string>> = {};
  const ios = httpsUrl(process.env.APP_UPDATE_URL_IOS);
  const android = httpsUrl(process.env.APP_UPDATE_URL_ANDROID);
  if (ios) updateUrl.ios = ios;
  if (android) updateUrl.android = android;
  return {
    minVersion: { ios: formatVersion(minVersionFor('ios')), android: formatVersion(minVersionFor('android')) },
    updateUrl,
  };
};

export type AppVersionVerdict = 'not_app' | 'ok' | 'update_required';

/**
 * No app headers at all → `not_app` (the website, webhooks, cron).
 * Any app header present → both must be valid and at or above the minimum;
 * a half-sent or malformed pair is refused, never waved through.
 */
export const checkAppVersion = (versionHeader: unknown, platformHeader: unknown): AppVersionVerdict => {
  const hasVersion = versionHeader !== undefined && versionHeader !== '';
  const hasPlatform = platformHeader !== undefined && platformHeader !== '';
  if (!hasVersion && !hasPlatform) return 'not_app';
  const version = parseVersion(versionHeader);
  if (!version || !isAppPlatform(platformHeader)) return 'update_required';
  return compareVersions(version, minVersionFor(platformHeader)) < 0 ? 'update_required' : 'ok';
};
