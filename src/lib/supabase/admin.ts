import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicEnvironment } from "./env";

export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error("Supabase server integration is not configured.");
  const { url } = getSupabasePublicEnvironment();
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}
