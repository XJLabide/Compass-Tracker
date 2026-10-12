import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { UpdatePasswordForm } from "@/app/auth/forms";
import { createClient } from "@/lib/supabase/server";

export default function UpdatePasswordPage() {
  return (
    <main className="auth-shell">
      <Suspense fallback={<div className="auth-panel">Checking your recovery session…</div>}>
        <UpdatePasswordContent />
      </Suspense>
    </main>
  );
}

async function UpdatePasswordContent() {
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/sign-in");

  return <UpdatePasswordForm />;
}
