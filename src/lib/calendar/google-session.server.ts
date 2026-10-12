import { GoogleCalendarProvider } from "@/lib/providers/google-calendar.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptGoogleRefreshToken, getGoogleCalendarOAuthConfig } from "./google-oauth.server";

export class CalendarProviderNotConfiguredError extends Error {}
export class CalendarProviderNotConnectedError extends Error {}

export async function getGoogleCalendarProvider(
  ownerId: string,
  origin: string,
): Promise<GoogleCalendarProvider> {
  const config = getGoogleCalendarOAuthConfig(origin);
  if (!config) throw new CalendarProviderNotConfiguredError("Google Calendar OAuth is not configured for this environment.");

  const admin = createAdminClient();
  const connectionResult = await admin.rpc("read_google_calendar_connection", { p_user_id: ownerId });
  if (connectionResult.error) throw new Error("Google Calendar connection could not be loaded.");
  const connection = connectionResult.data as {
    encrypted_refresh_token?: string;
    encryption_iv?: string;
  } | null;
  if (!connection?.encrypted_refresh_token || !connection.encryption_iv) {
    throw new CalendarProviderNotConnectedError("Connect a Google Calendar to import events.");
  }

  const refreshToken = decryptGoogleRefreshToken(
    connection.encrypted_refresh_token,
    connection.encryption_iv,
    config.encryptionKey,
  );
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    cache: "no-store",
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const token = await tokenResponse.json() as { access_token?: string; error?: string };
  if (!tokenResponse.ok || !token.access_token) {
    if (token.error === "invalid_grant") {
      throw new CalendarProviderNotConnectedError("The Google Calendar connection expired. Connect it again.");
    }
    throw new Error("Google Calendar could not refresh its access token.");
  }
  return new GoogleCalendarProvider(token.access_token);
}
