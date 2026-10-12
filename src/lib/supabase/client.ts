import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicEnvironment } from "./env";

export function createClient() {
  const { url, key } = getSupabasePublicEnvironment();
  return createBrowserClient(url, key);
}
