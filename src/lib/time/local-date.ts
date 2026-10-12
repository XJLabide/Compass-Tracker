export function localDateKey(date: Date, timeZone: string): string {
  const values = new Map(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );

  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}
