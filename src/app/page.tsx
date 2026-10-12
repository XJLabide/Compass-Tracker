import Link from "next/link";
import { hasSupabasePublicEnvironment } from "@/lib/supabase/env";

export default function Home() {
  const configured = hasSupabasePublicEnvironment();

  return (
    <main className="lab-shell">
      <section className="lab-card home-card">
        <div className="brand-mark" aria-hidden="true">C</div>
        <span className="eyebrow">COMPASS · PLATFORM LAB</span>
        <h1>A steadier way<br />to find your next step.</h1>
        <p className="lede">Phase 0 is setting up the private account, data, and offline foundations behind Compass.</p>
        <div className="foundation-row">
          <span className={configured ? "status-dot" : "status-dot status-dot-muted"} aria-hidden="true" />
          <div>
            <strong>{configured ? "Supabase connected" : "Local connection needed"}</strong>
            <small>{configured ? "Account and session prototype ready" : "Set up the local stack to continue"}</small>
          </div>
        </div>
        <Link className="button button-primary" href="/sign-in">Open account access <span aria-hidden="true">→</span></Link>
        <div className="platform-note"><span>Auth</span><span>RLS</span><span>Offline sync</span><span>Recovery</span></div>
      </section>
      <footer className="lab-footer">Private by default <span>·</span> Built around your local day</footer>
    </main>
  );
}
