import { describe, expect, it } from "vitest";
import { localDateTimeToInstant, localDateTimeInput, partitionCalendarDay } from "./rules";

describe("partitionCalendarDay", () => {
  it("keeps timed events separate from date-only task due work in the profile timezone", () => {
    const result = partitionCalendarDay(
      [
        {
          id: "meeting",
          title: "Team check-in",
          starts_at: "2026-10-12T01:00:00.000Z",
          ends_at: "2026-10-12T01:30:00.000Z",
        },
      ],
      [
        { id: "task-today", title: "Send the outline", due_date: "2026-10-12", status: "open" },
        { id: "task-tomorrow", title: "Review the deck", due_date: "2026-10-13", status: "open" },
      ],
      "2026-10-12",
      "Asia/Manila",
    );

    expect(result).toEqual({
      events: ["meeting"],
      dueTasks: ["task-today"],
    });
  });

  it("includes a timed event that overlaps the selected day even when it starts the day before", () => {
    const result = partitionCalendarDay(
      [
        {
          id: "overnight",
          title: "Overnight travel",
          starts_at: "2026-10-11T15:00:00.000Z",
          ends_at: "2026-10-12T17:00:00.000Z",
        },
      ],
      [],
      "2026-10-12",
      "Asia/Manila",
    );

    expect(result).toEqual({ events: ["overnight"], dueTasks: [] });
  });

  it("does not include an event that ends exactly at the selected day boundary", () => {
    const result = partitionCalendarDay(
      [
        {
          id: "previous-night",
          title: "Late call",
          starts_at: "2026-10-11T14:00:00.000Z",
          ends_at: "2026-10-11T16:00:00.000Z",
        },
      ],
      [],
      "2026-10-12",
      "Asia/Manila",
    );

    expect(result).toEqual({ events: [], dueTasks: [] });
  });
});

describe("calendar timezone conversion", () => {
  it("converts a local event time to an instant and back using its explicit timezone", () => {
    const instant = localDateTimeToInstant("2026-10-12T09:00", "Asia/Manila");
    expect(instant).toBe("2026-10-12T01:00:00.000Z");
    expect(localDateTimeInput(instant, "Asia/Manila")).toBe("2026-10-12T09:00");
  });

  it("rejects a local time skipped by a daylight-saving clock change", () => {
    expect(() => localDateTimeToInstant("2026-03-08T02:30", "America/Los_Angeles"))
      .toThrow("That local time is ambiguous or invalid for the selected timezone.");
  });
});
