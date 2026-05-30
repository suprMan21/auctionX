/**
 * Feature flags exposed to the frontend.
 *
 * Source of truth at build time: `import.meta.env.VITE_FEATURE_YOTI_ENABLED`.
 * The backend reads `process.env.FEATURE_YOTI_ENABLED` independently — when
 * the two disagree, the backend wins (UI may show the Start button but the
 * call returns 503 + YOTI_NOT_AVAILABLE). Setting the build-time flag matches
 * the App Runner env-var literal pattern (see backend `featureFlag.ts`).
 *
 * Defaults OFF until S22.5 wires Yoti live.
 */

const truthy = (v: unknown): boolean => v === 'true' || v === '1' || v === true;

export const getFeatureFlags = () => ({
  yotiEnabled: truthy(import.meta.env.VITE_FEATURE_YOTI_ENABLED),
});

export const isYotiEnabledOnClient = (): boolean => getFeatureFlags().yotiEnabled;
