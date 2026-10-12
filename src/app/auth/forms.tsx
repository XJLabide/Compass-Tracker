"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { safeLocalPath } from "@/lib/auth/redirect";

type Mode = "sign-in" | "sign-up" | "reset";

export function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnPath = safeLocalPath(searchParams.get("next"));
  const [mode, setMode] = useState<Mode>("sign-in");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    setMessage("");
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const supabase = createClient();

    const result =
      mode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : mode === "sign-up"
          ? await supabase.auth.signUp({
              email,
              password,
              options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(returnPath)}` },
            })
          : await supabase.auth.resetPasswordForEmail(email, {
              redirectTo: `${window.location.origin}/auth/callback?next=/account/update-password`,
            });

    setPending(false);
    if (result.error) {
      setMessage(result.error.message);
      return;
    }

    if (mode === "sign-in") {
      router.replace(returnPath);
      router.refresh();
    } else if (mode === "sign-up") {
      if ("session" in result.data && result.data.session) {
        router.replace(returnPath);
        router.refresh();
      } else {
        setMessage("Check the local Supabase email inbox to confirm your account.");
      }
    } else {
      setMessage("If that email has an account, a password reset link is on its way.");
    }
  }

  async function signInWithGoogle() {
    setPending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(returnPath)}` },
    });
    if (error) {
      setPending(false);
      setMessage(error.message);
    }
  }

  const initialError = searchParams.get("error");

  return (
    <div className="auth-panel">
      <div className="auth-heading">
        <span className="eyebrow">ACCOUNT ACCESS</span>
        <h1>{mode === "sign-in" ? "Welcome back" : mode === "sign-up" ? "Create your account" : "Reset password"}</h1>
        <p>Compass keeps your data private and synced across your devices.</p>
      </div>

      {mode !== "reset" && (
        <button className="button button-secondary" type="button" onClick={signInWithGoogle} disabled={pending}>
          Continue with Google
        </button>
      )}

      <div className="auth-divider"><span>or use email</span></div>

      <form action={submit} className="auth-fields">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
        {mode !== "reset" && (
          <>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              minLength={8}
              required
            />
          </>
        )}
        <button className="button button-primary" type="submit" disabled={pending}>
          {pending ? "Please wait…" : mode === "sign-in" ? "Sign in" : mode === "sign-up" ? "Create account" : "Send reset link"}
        </button>
      </form>

      {(message || initialError) && (
        <p className="form-message" role="status">
          {message || "We couldn’t complete that sign-in. Try again or request a new link."}
        </p>
      )}

      <div className="auth-links">
        {mode === "sign-in" ? (
          <>
            <button type="button" onClick={() => setMode("reset")}>Forgot password?</button>
            <button type="button" onClick={() => setMode("sign-up")}>Create account</button>
          </>
        ) : (
          <button type="button" onClick={() => setMode("sign-in")}>Back to sign in</button>
        )}
      </div>
    </div>
  );
}

export function UpdatePasswordForm() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    const password = String(formData.get("password") ?? "");
    setPending(true);
    const { error } = await createClient().auth.updateUser({ password });
    setPending(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    router.replace("/today");
    router.refresh();
  }

  return (
    <div className="auth-panel">
      <div className="auth-heading">
        <span className="eyebrow">ACCOUNT ACCESS</span>
        <h1>Choose a new password</h1>
        <p>Use at least eight characters.</p>
      </div>
      <form action={submit} className="auth-fields">
        <label htmlFor="password">New password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        <button className="button button-primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save password"}
        </button>
      </form>
      {message && <p className="form-message" role="alert">{message}</p>}
    </div>
  );
}
