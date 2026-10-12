import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicEnvironment } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return NextResponse.json({ error: "Account deletion is not configured on this environment" }, { status: 503 });
  }

  const userClient = await createClient();
  const { data } = await userClient.auth.getClaims();
  const ownerId = data?.claims?.sub;
  if (typeof ownerId !== "string") {
    return NextResponse.json({ error: "Sign in before deleting this account" }, { status: 401 });
  }

  const { url } = getSupabasePublicEnvironment();
  const admin = createSupabaseAdmin(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const deletedAt = new Date();
  const purgeAfter = new Date(deletedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  const { error: tombstoneError } = await admin.from("account_deletion_tombstones").upsert({
    owner_id: ownerId,
    deleted_at: deletedAt.toISOString(),
    purge_after: purgeAfter.toISOString(),
  });
  if (tombstoneError) {
    return NextResponse.json({ error: "Could not record the deletion request. No account data was removed." }, { status: 500 });
  }

  const { error: deletionError } = await admin.auth.admin.deleteUser(ownerId);
  if (deletionError) {
    await admin.from("account_deletion_tombstones").delete().eq("owner_id", ownerId);
    return NextResponse.json({ error: "Account deletion failed. Please try again while online." }, { status: 500 });
  }

  await userClient.auth.signOut();
  return NextResponse.json({ deleted: true });
}
