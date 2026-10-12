export function localDateTimeToIso(date: string, time: string, timezone = "UTC"): string | null {
  if (!date || !time) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let instant = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = dateTimeParts(new Date(instant), timezone);
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    const next = desired - (represented - instant);
    if (next === instant) break;
    instant = next;
  }
  const parsed = new Date(instant);
  const parts = dateTimeParts(parsed, timezone);
  if (parts.year !== String(year) || parts.month !== pad(month) || parts.day !== pad(day) || parts.hour !== pad(hour) || parts.minute !== pad(minute)) return null;
  return parsed.toISOString();
}

export function isoToLocalDateTimeParts(value: string | null, timezone = "UTC"): { date: string; time: string } {
  if (!value) return { date: "", time: "" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };
  const parts = dateTimeParts(date, timezone);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function dateTimeParts(date: Date, timezone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function pad(value: number): string { return String(value).padStart(2, "0"); }
