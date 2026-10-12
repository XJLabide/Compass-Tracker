import { describe, expect, it } from "vitest";
import { localDateKey } from "./local-date";

describe("localDateKey", () => {
  it("uses the user's timezone instead of UTC when assigning a calendar day", () => {
    const instant = new Date("2026-01-01T01:30:00.000Z");

    expect(localDateKey(instant, "America/Los_Angeles")).toBe("2025-12-31");
    expect(localDateKey(instant, "Asia/Manila")).toBe("2026-01-01");
  });
});
