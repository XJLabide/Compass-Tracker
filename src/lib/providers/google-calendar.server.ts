import type { CalendarEvent, CalendarProvider, CalendarSummary } from "./contracts";

const calendarApi = "https://www.googleapis.com/calendar/v3";
const pageSize = 250;
const maxEventsPerCalendar = 5000;

interface GoogleCalendarListResponse {
  items?: Array<{ id?: string; summary?: string; timeZone?: string }>;
  nextPageToken?: string;
}

interface GoogleEventListResponse {
  items?: Array<{
    id?: string;
    status?: string;
    summary?: string;
    description?: string;
    updated?: string;
    start?: { dateTime?: string; timeZone?: string };
    end?: { dateTime?: string; timeZone?: string };
  }>;
  nextPageToken?: string;
}

export class GoogleCalendarProvider implements CalendarProvider {
  constructor(
    private readonly accessToken: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  async listCalendars(): Promise<CalendarSummary[]> {
    const calendars: CalendarSummary[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({ maxResults: String(pageSize), showDeleted: "false" });
      if (pageToken) query.set("pageToken", pageToken);
      const page = await this.get<GoogleCalendarListResponse>(`/users/me/calendarList?${query}`);
      calendars.push(...(page.items ?? []).flatMap((item) =>
        item.id && item.summary
          ? [{ id: item.id, name: item.summary, timeZone: item.timeZone }]
          : [],
      ));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return calendars;
  }

  async readEvents(calendarIds: string[], from: string, through: string): Promise<CalendarEvent[]> {
    if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(through)) || Date.parse(through) <= Date.parse(from)) {
      throw new Error("Calendar import range is invalid.");
    }
    const selectedIds = [...new Set(calendarIds.filter((id) => id.trim()))];
    if (selectedIds.length > 200) throw new Error("Choose no more than 200 calendars per import.");

    const result: CalendarEvent[] = [];
    for (const calendarId of selectedIds) {
      let pageToken: string | undefined;
      let calendarCount = 0;
      do {
        const query = new URLSearchParams({
          maxResults: String(pageSize),
          singleEvents: "true",
          showDeleted: "false",
          orderBy: "startTime",
          timeMin: from,
          timeMax: through,
        });
        if (pageToken) query.set("pageToken", pageToken);
        const page = await this.get<GoogleEventListResponse>(
          `/calendars/${encodeURIComponent(calendarId)}/events?${query}`,
        );
        const events = (page.items ?? []).flatMap((item) => {
          const start = item.start?.dateTime;
          const end = item.end?.dateTime;
          if (!item.id || !start || !end || item.status === "cancelled") return [];
          return [{
            id: item.id,
            calendarId,
            title: item.summary?.trim() || "Untitled event",
            description: item.description ?? null,
            startsAt: start,
            endsAt: end,
            timeZone: item.start?.timeZone ?? item.end?.timeZone ?? "",
            sourceUpdatedAt: item.updated ?? null,
          }];
        });
        result.push(...events);
        calendarCount += events.length;
        if (calendarCount >= maxEventsPerCalendar && page.nextPageToken) {
          throw new Error("This calendar has more than 5,000 events in the selected range. Narrow the range and retry.");
        }
        pageToken = page.nextPageToken;
      } while (pageToken);
    }
    return result;
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.request(`${calendarApi}${path}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      throw new Error(body?.error?.message ?? `Google Calendar request failed (${response.status}).`);
    }
    return response.json() as Promise<T>;
  }
}
