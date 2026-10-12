import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default function TodayPage() {
  return (
    <Suspense fallback={<main className="lab-shell"><section className="lab-card">Loading today…</section></main>}>
      <TodayContent />
    </Suspense>
  );
}

async function TodayContent() {
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/sign-in");

  return (
    <main className="lab-shell">
      <section className="lab-card">
        <span className="status-dot" aria-hidden="true" />
        <span className="eyebrow">PHASE 0 · AUTH SESSION</span>
        <h1>Signed in</h1>
        <p>Your verified Supabase claims are available to this server-rendered route.</p>
        <code className="claim-id">{String(data.claims.sub)}</code>
        <Link className="button button-primary sync-lab-link" href="/sync-lab">Open the offline sync lab <span aria-hidden="true">→</span></Link>
        <form action="/auth/sign-out" method="post">
          <button className="button button-secondary" type="submit">Sign out</button>
        </form>
      </section>
    </main>
  );
}
