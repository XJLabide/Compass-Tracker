export interface LocalCalendarEvent {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  time_zone: string;
  status: "active" | "cancelled";
  revision: number;
}

export interface ExternalCalendar {
  id: string;
  provider: string;
  provider_calendar_id: string;
  name: string;
  selected: boolean;
  time_zone: string | null;
}

export interface ImportedCalendarEvent {
  id: string;
  external_calendar_id: string;
  provider_event_id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  time_zone: string;
  source_updated_at: string | null;
  imported_at: string;
}

export interface CalendarDaySnapshot {
  localEvents: LocalCalendarEvent[];
  importedEvents: ImportedCalendarEvent[];
}
