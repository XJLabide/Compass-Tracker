import { describe, expect, it, vi } from "vitest";
import { GoogleCalendarProvider } from "./google-calendar.server";

describe("GoogleCalendarProvider", () => {
  it("lists accessible calendars one page at a time", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(Response.json({
        items: [{ id: "primary", summary: "Personal", timeZone: "Asia/Manila" }],
        nextPageToken: "next-page",
      }))
      .mockResolvedValueOnce(Response.json({ items: [{ id: "team", summary: "Team" }] }));
    const provider = new GoogleCalendarProvider("access-token", request);

    await expect(provider.listCalendars()).resolves.toEqual([
      { id: "primary", name: "Personal", timeZone: "Asia/Manila" },
      { id: "team", name: "Team", timeZone: undefined },
    ]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][1]).toMatchObject({ headers: { Authorization: "Bearer access-token" } });
    expect(String(request.mock.calls[1][0])).toContain("pageToken=next-page");
  });

  it("reads only the selected calendar IDs and imports timed, non-cancelled events", async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ items: [
      { id: "timed", summary: "Planning", start: { dateTime: "2026-10-12T09:00:00+08:00", timeZone: "Asia/Manila" }, end: { dateTime: "2026-10-12T09:30:00+08:00" }, updated: "2026-10-11T12:00:00Z" },
      { id: "all-day", summary: "Holiday", start: { date: "2026-10-12" }, end: { date: "2026-10-13" } },
      { id: "cancelled", status: "cancelled", summary: "Removed", start: { dateTime: "2026-10-12T10:00:00Z" }, end: { dateTime: "2026-10-12T10:30:00Z" } },
    ] }));
    const provider = new GoogleCalendarProvider("access-token", request);

    await expect(provider.readEvents(
      ["selected/calendar"], "2026-10-12T00:00:00+08:00", "2026-10-13T00:00:00+08:00",
    )).resolves.toEqual([{
      id: "timed",
      calendarId: "selected/calendar",
      title: "Planning",
      description: null,
      startsAt: "2026-10-12T09:00:00+08:00",
      endsAt: "2026-10-12T09:30:00+08:00",
      timeZone: "Asia/Manila",
      sourceUpdatedAt: "2026-10-11T12:00:00Z",
    }]);
    expect(String(request.mock.calls[0][0])).toContain("/calendars/selected%2Fcalendar/events?");
    expect(String(request.mock.calls[0][0])).toContain("timeMin=2026-10-12T00%3A00%3A00%2B08%3A00");
  });

  it("rejects reversed import ranges before sending a request", async () => {
    const request = vi.fn();
    const provider = new GoogleCalendarProvider("access-token", request);

    await expect(provider.readEvents(["primary"], "2026-10-13T00:00:00Z", "2026-10-12T00:00:00Z"))
      .rejects.toThrow("Calendar import range is invalid.");
    expect(request).not.toHaveBeenCalled();
  });
});
