/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_FEATURE_YOTI_ENABLED: string
  readonly VITE_FEATURE_MARKETPLACE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}
