import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_FOLLOW_MANAGER_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_FOLLOW_MANAGER_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing VITE_FOLLOW_MANAGER_SUPABASE_URL or VITE_FOLLOW_MANAGER_SUPABASE_ANON_KEY."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
