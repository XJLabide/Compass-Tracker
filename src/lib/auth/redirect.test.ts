import { describe, expect, it } from "vitest";
import { safeLocalPath } from "./redirect";

describe("safe post-auth redirects", () => {
  it("preserves a requested in-app route and query string", () => {
    expect(safeLocalPath("/tasks?view=upcoming")).toBe("/tasks?view=upcoming");
  });

  it("rejects absolute, protocol-relative, and empty destinations", () => {
    expect(safeLocalPath("https://outside.example/")).toBe("/today");
    expect(safeLocalPath("//outside.example/")).toBe("/today");
    expect(safeLocalPath(null)).toBe("/today");
  });
});
