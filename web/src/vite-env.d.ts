/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FOLLOW_MANAGER_SUPABASE_URL: string;
  readonly VITE_FOLLOW_MANAGER_SUPABASE_ANON_KEY: string;
  readonly VITE_FOLLOW_MANAGER_BASE_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
