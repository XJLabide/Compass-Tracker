import { NextResponse, type NextRequest } from "next/server";
import { CalendarProviderNotConnectedError, getGoogleCalendarProvider } from "@/lib/calendar/google-session.server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const maxRangeMs = 31 * 24 * 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (typeof claims?.claims?.sub !== "string") return NextResponse.json({ error: "Sign in to import calendar events." }, { status: 401 });

  try {
    const range = await request.json() as { from?: unknown; through?: unknown };
    if (typeof range.from !== "string" || typeof range.through !== "string"
      || !Number.isFinite(Date.parse(range.from)) || !Number.isFinite(Date.parse(range.through))
      || Date.parse(range.through) <= Date.parse(range.from)
      || Date.parse(range.through) - Date.parse(range.from) > maxRangeMs) {
      return NextResponse.json({ error: "Choose a valid import range of 31 days or less." }, { status: 400 });
    }
    const { data: selected, error: selectedError } = await supabase.from("external_calendars")
      .select("id,provider_calendar_id,time_zone").eq("provider", "google").eq("selected", true);
    if (selectedError) throw new Error(selectedError.message);
    if (!selected?.length) return NextResponse.json({ imported: 0, message: "Choose at least one calendar to import." });

    const provider = await getGoogleCalendarProvider(claims.claims.sub, request.nextUrl.origin);
    const providerEvents = await provider.readEvents(
      selected.map(({ provider_calendar_id }) => provider_calendar_id),
      range.from,
      range.through,
    );
    const calendarIds = new Map(selected.map(({ id, provider_calendar_id }) => [provider_calendar_id, id]));
    const calendarTimeZones = new Map(selected.map(({ provider_calendar_id, time_zone }) => [provider_calendar_id, time_zone]));
    const events = providerEvents.map((event) => ({
      external_calendar_id: calendarIds.get(event.calendarId),
      provider_event_id: event.id,
      title: event.title,
      description: event.description,
      starts_at: event.startsAt,
      ends_at: event.endsAt,
      time_zone: event.timeZone || calendarTimeZones.get(event.calendarId) || "UTC",
      source_updated_at: event.sourceUpdatedAt,
    }));
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("import_google_calendar_events", {
      p_user_id: claims.claims.sub,
      p_calendar_ids: selected.map(({ id }) => id),
      p_events: events,
      p_from: range.from,
      p_through: range.through,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json(data as { imported: number });
  } catch (error) {
    if (error instanceof CalendarProviderNotConnectedError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof Error && error.message.includes("not configured")) {
      return NextResponse.json({ error: "Google Calendar is not configured here yet." }, { status: 503 });
    }
    return NextResponse.json({ error: "Events could not be imported. Check the connection and try again." }, { status: 502 });
  }
}
