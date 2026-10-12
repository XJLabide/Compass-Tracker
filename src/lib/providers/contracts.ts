import type { JsonValue } from "@/lib/offline/outbox";

export interface AssistantProvider {
  propose(request: string, relevantContext: JsonValue): Promise<AssistantProposal>;
}

export interface AssistantProposal {
  summary: string;
  operations: ProposedOperation[];
  provider: string;
}

export interface ProposedOperation {
  operation: string;
  input: JsonValue;
}

export interface QuoteProvider {
  getQuotes(symbols: string[]): Promise<ProviderResult<Quote[]>>;
}

export interface ExchangeRateProvider {
  getRates(base: string, quotes: string[]): Promise<ProviderResult<ExchangeRate[]>>;
}

export interface CalendarProvider {
  listSelectedCalendars(): Promise<CalendarSummary[]>;
  readEvents(calendarIds: string[], from: string, through: string): Promise<CalendarEvent[]>;
}

export interface ReminderScheduler {
  schedule(reminder: ReminderRequest): Promise<{ id: string }>;
  cancel(id: string): Promise<void>;
}

export interface ProviderResult<T> {
  values: T[];
  source: string;
  asOf: string;
  status: "fresh" | "stale" | "unavailable";
  reason?: string;
}

export interface Quote {
  symbol: string;
  currency: string;
  priceMinor: number;
}

export interface ExchangeRate {
  quote: string;
  rate: number;
}

export interface CalendarSummary {
  id: string;
  name: string;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  startsAt: string;
  endsAt: string;
}

export interface ReminderRequest {
  ownerId: string;
  title: string;
  at: string;
  optedInAt: string;
}
