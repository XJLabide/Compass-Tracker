import { describe, expect, it } from "vitest";
import { convertMinorUnits, formatMinorUnits, minorUnitsInput, multiplyMinorUnitsByQuantity, parseMinorUnits } from "./money";

describe("minor-unit money helpers", () => {
  it("parses decimal input without floating-point rounding", () => {
    expect(parseMinorUnits("123456789012.34", "USD")).toBe("12345678901234");
    expect(parseMinorUnits("120", "JPY")).toBe("120");
    expect(parseMinorUnits("1.234", "KWD")).toBe("1234");
  });

  it("rejects fractional precision unsupported by the currency", () => {
    expect(parseMinorUnits("1.001", "USD")).toBeNull();
    expect(parseMinorUnits("1.1", "JPY")).toBeNull();
    expect(parseMinorUnits("not-money", "USD")).toBeNull();
  });

  it("formats large minor-unit amounts without converting through Number", () => {
    expect(formatMinorUnits("12345678901234", "USD", "en-US")).toBe("$123,456,789,012.34");
    expect(formatMinorUnits("-5", "USD", "en-US")).toBe("-$0.05");
  });

  it("produces editable decimal text from stored minor units", () => {
    expect(minorUnitsInput("12345", "USD")).toBe("123.45");
    expect(minorUnitsInput("120", "JPY")).toBe("120");
    expect(minorUnitsInput("50", "USD")).toBe("0.5");
  });

  it("converts using a decimal FX rate and records a rounded target minor amount", () => {
    expect(convertMinorUnits("1000", "USD", "PHP", "56.12345678")).toBe("56123");
    expect(convertMinorUnits("100", "USD", "USD", "1")).toBe("100");
  });

  it("values fractional portfolio units without floating-point arithmetic", () => {
    expect(multiplyMinorUnitsByQuantity("5000", "2.25")).toBe("11250");
    expect(multiplyMinorUnitsByQuantity("1", "0.5")).toBe("1");
  });
});
