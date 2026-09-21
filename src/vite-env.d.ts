/// <reference types="vite/client" />

interface ImportMetaEnv {
  // reCAPTCHA Enterprise site key for Firebase App Check. Optional -- App Check is
  // fully inert (nothing initialized) when this isn't set. Not a secret
  // (verified server-side by Google), so it's fine to set directly in
  // Vercel's project env vars without marking it sensitive.
  readonly VITE_RECAPTCHA_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Injected at build time by vite.config.ts's `define`, from package.json's version.
declare const __APP_VERSION__: string;
