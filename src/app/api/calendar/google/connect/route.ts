import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getGoogleCalendarOAuthConfig } from "@/lib/calendar/google-oauth.server";
import { createClient } from "@/lib/supabase/server";

const stateCookie = "compass-google-calendar-state";
const verifierCookie = "compass-google-calendar-verifier";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (typeof data?.claims?.sub !== "string") return NextResponse.redirect(new URL("/sign-in?next=%2Fcalendar", request.url));

  const config = getGoogleCalendarOAuthConfig(request.nextUrl.origin);
  if (!config) return NextResponse.redirect(new URL("/calendar?calendar_error=not-configured", request.url));

  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email https://www.googleapis.com/auth/calendar.readonly",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  }).toString();

  const response = NextResponse.redirect(authorizationUrl);
  const secure = request.nextUrl.protocol === "https:";
  const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure, path: "/api/calendar/google", maxAge: 600 };
  response.cookies.set(stateCookie, state, cookieOptions);
  response.cookies.set(verifierCookie, verifier, cookieOptions);
  return response;
}
