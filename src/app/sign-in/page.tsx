import { Suspense } from "react";
import { AuthForm } from "@/app/auth/forms";
import { hasSupabasePublicEnvironment } from "@/lib/supabase/env";

export default function SignInPage() {
  if (!hasSupabasePublicEnvironment()) {
    return (
      <main className="auth-shell">
        <div className="auth-panel setup-panel">
          <span className="eyebrow">LOCAL SETUP</span>
          <h1>Connect the local Supabase project</h1>
          <p>Copy <code>.env.example</code> to <code>.env.local</code>, then use the URL and publishable key printed by <code>npm run supabase:start</code>.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <Suspense fallback={<div className="auth-panel">Loading account access…</div>}>
        <AuthForm />
      </Suspense>
    </main>
  );
}
