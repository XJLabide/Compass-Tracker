import { localDateKey } from "../time/local-date";

interface CalendarEventInterval {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
}

interface DueTask {
  id: string;
  title: string;
  due_date: string | null;
  status: "open" | "done" | "archived";
}

export function partitionCalendarDay(
  events: CalendarEventInterval[],
  tasks: DueTask[],
  localDate: string,
  timeZone: string,
): { events: string[]; dueTasks: string[] } {
  const { start, end } = localDayBounds(localDate, timeZone);
  return {
    events: events
      .filter(({ starts_at, ends_at }) => {
        const startsAt = Date.parse(starts_at);
        const endsAt = Date.parse(ends_at);
        return Number.isFinite(startsAt) && Number.isFinite(endsAt) && startsAt < end && endsAt > start;
      })
      .map(({ id }) => id),
    dueTasks: tasks
      .filter(({ due_date, status }) => due_date === localDate && status !== "archived")
      .map(({ id }) => id),
  };
}

export function localDayBounds(localDate: string, timeZone: string): { start: number; end: number } {
  const start = firstInstantOnOrAfter(localDate, timeZone);
  const nextDate = new Date(`${localDate}T12:00:00.000Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const end = firstInstantOnOrAfter(nextDate.toISOString().slice(0, 10), timeZone);
  return { start, end };
}

export function localDateTimeToInstant(localDateTime: string, timeZone: string): string {
  const desiredLocal = Date.parse(`${localDateTime}:00.000Z`);
  if (!Number.isFinite(desiredLocal)) throw new Error("Enter a valid start and end time.");
  let candidate = desiredLocal;
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = new Map(format.formatToParts(new Date(candidate)).map(({ type, value }) => [type, value]));
    const representedAsUtc = Date.UTC(
      Number(parts.get("year")), Number(parts.get("month")) - 1, Number(parts.get("day")),
      Number(parts.get("hour")), Number(parts.get("minute")), Number(parts.get("second")),
    );
    const adjustment = desiredLocal - representedAsUtc;
    if (adjustment === 0) {
      const roundTrip = format.formatToParts(new Date(candidate));
      const output = new Map(roundTrip.map(({ type, value }) => [type, value]));
      if (`${output.get("year")}-${output.get("month")}-${output.get("day")}T${output.get("hour")}:${output.get("minute")}` !== localDateTime) {
        throw new Error("That local time does not exist because the timezone changes its clock then.");
      }
      return new Date(candidate).toISOString();
    }
    candidate += adjustment;
  }

  throw new Error("That local time is ambiguous or invalid for the selected timezone.");
}

export function localDateTimeInput(instant: string, timeZone: string): string {
  const parts = new Map(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant)).map(({ type, value }) => [type, value]));
  return `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}T${parts.get("hour")}:${parts.get("minute")}`;
}

function firstInstantOnOrAfter(localDate: string, timeZone: string): number {
  const utcMidnight = Date.parse(`${localDate}T00:00:00.000Z`);
  let low = utcMidnight - 36 * 60 * 60 * 1000;
  let high = utcMidnight + 36 * 60 * 60 * 1000;

  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (localDateKey(new Date(middle), timeZone) < localDate) low = middle + 1;
    else high = middle;
  }

  return low;
}
