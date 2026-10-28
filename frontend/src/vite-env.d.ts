/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_FEATURE_YOTI_ENABLED: string
  readonly VITE_FEATURE_MARKETPLACE: string
  /** S-MOB1: tester install links shown on /app/open (optional). */
  /** S-MOB1: origin serving /app/open (another domain than this site; default https://authentic-materials.com). */
  readonly VITE_APP_OPEN_ORIGIN?: string
  readonly VITE_TESTFLIGHT_URL?: string
  readonly VITE_PLAY_TESTING_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}
