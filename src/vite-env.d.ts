/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Build-time default Embassy base URL (see `src/net/config.ts` DEFAULT_OFFICIAL_URL). Set per
   *  environment via `.env` files; unset ⇒ '' ⇒ no default (the player sets a URL in the Registry). */
  readonly VITE_EMBASSY_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
