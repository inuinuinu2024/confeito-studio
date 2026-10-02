/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend API base URL, e.g. http://127.0.0.1:48000/api */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
