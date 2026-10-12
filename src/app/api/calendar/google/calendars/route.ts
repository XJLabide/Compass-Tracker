import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CalendarProviderNotConnectedError, getGoogleCalendarProvider } from "@/lib/calendar/google-session.server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (typeof claims?.claims?.sub !== "string") return NextResponse.json({ error: "Sign in to connect a calendar." }, { status: 401 });

  try {
    const provider = await getGoogleCalendarProvider(claims.claims.sub, request.nextUrl.origin);
    const [available, selectedResult] = await Promise.all([
      provider.listCalendars(),
      supabase.from("external_calendars").select("id,provider_calendar_id,selected")
        .eq("provider", "google").eq("selected", true),
    ]);
    if (selectedResult.error) throw new Error("Selected calendars could not be loaded.");
    const selected = new Map((selectedResult.data ?? []).map(({ id, provider_calendar_id }) => [provider_calendar_id, id]));
    return NextResponse.json({
      connected: true,
      calendars: available.slice(0, 200).map((calendar) => ({
        providerCalendarId: calendar.id,
        name: calendar.name,
        timeZone: calendar.timeZone ?? null,
        selected: selected.has(calendar.id),
        externalCalendarId: selected.get(calendar.id) ?? null,
      })),
    });
  } catch (error) {
    if (error instanceof CalendarProviderNotConnectedError) return NextResponse.json({ connected: false, calendars: [] });
    if (error instanceof Error && error.message.includes("not configured")) {
      return NextResponse.json({ configured: false, connected: false, calendars: [] });
    }
    return NextResponse.json({ error: "Google calendars could not be loaded. Reconnect and try again." }, { status: 502 });
  }
}

export async function PUT(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (typeof claims?.claims?.sub !== "string") return NextResponse.json({ error: "Sign in to select calendars." }, { status: 401 });

  try {
    const input = await request.json() as { selectedIds?: unknown };
    if (!Array.isArray(input.selectedIds) || input.selectedIds.some((id) => typeof id !== "string") || input.selectedIds.length > 200) {
      return NextResponse.json({ error: "Choose up to 200 calendars." }, { status: 400 });
    }
    const provider = await getGoogleCalendarProvider(claims.claims.sub as string, request.nextUrl.origin);
    const available = await provider.listCalendars();
    const shownCalendars = available.slice(0, 200);
    const requested = new Set(input.selectedIds as string[]);
    if ([...requested].some((id) => !shownCalendars.some((calendar) => calendar.id === id))) {
      return NextResponse.json({ error: "A calendar selection is no longer available. Refresh the list." }, { status: 400 });
    }
    const { data: existing, error: queryError } = await supabase.from("external_calendars")
      .select("id,provider_calendar_id").eq("provider", "google");
    if (queryError) throw new Error(queryError.message);
    const ids = new Map((existing ?? []).map(({ id, provider_calendar_id }) => [provider_calendar_id, id]));
    const calendars = shownCalendars.map((calendar) => ({
      id: ids.get(calendar.id) ?? crypto.randomUUID(),
      provider_calendar_id: calendar.id,
      name: calendar.name,
      time_zone: calendar.timeZone ?? null,
      selected: requested.has(calendar.id),
    }));
    const admin = createAdminClient();
    const { error } = await admin.rpc("save_google_calendar_selection", {
      p_user_id: claims.claims.sub as string,
      p_calendars: calendars,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ saved: true, selectedCount: requested.size });
  } catch (error) {
    if (error instanceof CalendarProviderNotConnectedError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof Error && error.message.includes("not configured")) {
      return NextResponse.json({ error: "Google Calendar is not configured here yet." }, { status: 503 });
    }
    return NextResponse.json({ error: "Calendar selection could not be saved." }, { status: 502 });
  }
}
