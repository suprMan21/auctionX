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
  marketplaceEnabled: truthy(import.meta.env.VITE_FEATURE_MARKETPLACE),
});

export const isYotiEnabledOnClient = (): boolean => getFeatureFlags().yotiEnabled;

/**
 * VITE_FEATURE_MARKETPLACE — S-ISO1. Default OFF.
 *
 * The auction marketplace and the Unmentionables stream are PARKED per the
 * 2026-09-18 token-first pivot. When false, marketplace routes, nav links and
 * CTAs are not rendered and a direct URL visit lands on the 404 page.
 *
 * The backend enforces the same park independently via FEATURE_MARKETPLACE, so
 * hiding the UI is defence in depth, never the control itself.
 *
 * NOTE (Lesson): a Vite shell env var beats a .env file, so set this explicitly
 * in the build step rather than relying on .env alone.
 */
export const isMarketplaceEnabledOnClient = (): boolean => getFeatureFlags().marketplaceEnabled;
