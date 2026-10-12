import { describe, expect, it } from "vitest";
import { isoToLocalDateTimeParts, localDateTimeToIso } from "../daily/timezone";
import { findSuggestedSession, formatPace } from "./flow";
import type { StrengthProgram, StrengthProgramDay } from "./types";

const program: StrengthProgram = { id: "p1", title: "Strength", notes: null, status: "active", revision: 1 };
const days: StrengthProgramDay[] = [
  { id: "flex", program_id: "p1", title: "Flexible", weekday: null, sort_order: 0, revision: 1 },
  { id: "today", program_id: "p1", title: "Lower body", weekday: 3, sort_order: 1, revision: 1 },
];

describe("Fitness flow helpers", () => {
  it("suggests a scheduled session before a flexible session", () => {
    expect(findSuggestedSession([program], days, 3, "2026-10-14")?.day.id).toBe("today");
  });

  it("suggests a flexible session when no schedule matches", () => {
    expect(findSuggestedSession([program], days, 4, "2026-10-15")?.day.id).toBe("flex");
  });

  it("suggests the least recently completed flexible session", () => {
    const laterFlex = { ...days[0], id: "flex-2", title: "Upper body", sort_order: 1 };
    expect(findSuggestedSession([program], [...days, laterFlex], 4, "2026-10-15", [
      { program_day_id: "flex", local_date: "2026-10-14" },
    ])?.day.id).toBe("flex-2");
  });

  it("does not suggest repeating a scheduled session already logged today", () => {
    expect(findSuggestedSession([program], [days[1]], 3, "2026-10-14", [
      { program_day_id: "today", local_date: "2026-10-14" },
    ])).toBeNull();
  });

  it("does not suggest archived programs", () => {
    expect(findSuggestedSession([{ ...program, status: "archived" }], days, 3, "2026-10-14")).toBeNull();
  });

  it("derives run pace and rejects incomplete distance", () => {
    expect(formatPace(5, 25, "km")).toBe("5:00 /km");
    expect(formatPace(0, 25, "mi")).toBeNull();
  });

  it("formats the local calendar parts of a saved timestamp", () => {
    expect(isoToLocalDateTimeParts("2026-10-14T09:00:00.000Z", "Asia/Manila")).toEqual({ date: "2026-10-14", time: "17:00" });
  });

  it("converts workout date and time using the selected profile timezone", () => {
    expect(localDateTimeToIso("2026-10-14", "17:00", "Asia/Manila")).toBe("2026-10-14T09:00:00.000Z");
  });
});
