import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SyncLab } from "./sync-lab";

export default function SyncLabPage() {
  return (
    <Suspense fallback={<main className="lab-shell"><section className="lab-card">Loading sync prototype…</section></main>}>
      <SyncLabContent />
    </Suspense>
  );
}

async function SyncLabContent() {
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (typeof data?.claims?.sub !== "string") redirect("/sign-in");

  return <SyncLab ownerId={data.claims.sub} />;
}
