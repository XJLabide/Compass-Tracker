import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { encryptGoogleRefreshToken, getGoogleCalendarOAuthConfig } from "@/lib/calendar/google-oauth.server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const stateCookie = "compass-google-calendar-state";
const verifierCookie = "compass-google-calendar-verifier";
const calendarScope = "https://www.googleapis.com/auth/calendar.readonly";

export async function GET(request: NextRequest) {
  const failure = (reason: string) => {
    const response = NextResponse.redirect(new URL(`/calendar?calendar_error=${encodeURIComponent(reason)}`, request.url));
    clearOauthCookies(response);
    return response;
  };

  const providerError = request.nextUrl.searchParams.get("error");
  if (providerError) return failure(providerError === "access_denied" ? "consent-denied" : "provider-error");

  const code = request.nextUrl.searchParams.get("code");
  const providedState = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(stateCookie)?.value;
  const verifier = request.cookies.get(verifierCookie)?.value;
  if (!code || !providedState || !expectedState || !verifier || !constantTimeEqual(providedState, expectedState)) {
    return failure("invalid-oauth-state");
  }

  const config = getGoogleCalendarOAuthConfig(request.nextUrl.origin);
  if (!config) return failure("not-configured");
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (typeof claims?.claims?.sub !== "string") return NextResponse.redirect(new URL("/sign-in?next=%2Fcalendar", request.url));

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    cache: "no-store",
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  if (!tokenResponse.ok) return failure("token-exchange-failed");
  const tokens = await tokenResponse.json() as { refresh_token?: string; scope?: string };
  const grantedScopes = new Set((tokens.scope ?? "").split(/\s+/).filter(Boolean));
  if (!grantedScopes.has(calendarScope)) return failure("readonly-scope-required");

  let encrypted: { ciphertext: string; iv: string };
  if (tokens.refresh_token) {
    encrypted = encryptGoogleRefreshToken(tokens.refresh_token, config.encryptionKey);
  } else {
    const admin = createAdminClient();
    const existing = await admin.rpc("read_google_calendar_connection", { p_user_id: claims.claims.sub });
    const saved = existing.data as { encrypted_refresh_token?: string; encryption_iv?: string } | null;
    if (existing.error || !saved?.encrypted_refresh_token || !saved.encryption_iv) return failure("refresh-token-unavailable");
    encrypted = { ciphertext: saved.encrypted_refresh_token, iv: saved.encryption_iv };
  }
  const admin = createAdminClient();
  const { error } = await admin.rpc("store_google_calendar_connection", {
    p_user_id: claims.claims.sub,
    p_provider_email: null,
    p_encrypted_refresh_token: encrypted.ciphertext,
    p_encryption_iv: encrypted.iv,
    p_granted_scopes: [...grantedScopes],
  });
  if (error) return failure("connection-save-failed");

  const response = NextResponse.redirect(new URL("/calendar?calendar=connected", request.url));
  clearOauthCookies(response);
  return response;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function clearOauthCookies(response: NextResponse) {
  response.cookies.set(stateCookie, "", { path: "/api/calendar/google", maxAge: 0 });
  response.cookies.set(verifierCookie, "", { path: "/api/calendar/google", maxAge: 0 });
}
