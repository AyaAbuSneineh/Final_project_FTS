
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogAttributeValue = string | number | boolean;
export type LogAttributes = Record<string, LogAttributeValue>;

export interface ValidLogInput {
  timestamp: Date;
  level: LogLevel;
  service: string;
  message: string;
  attributes: LogAttributes;
} 
export interface RejectedLog {
  index: number;
  reason: string;
}

export interface ValidationSuccess {
  valid: true;
  log: ValidLogInput;
}

export interface ValidationFailure {
  valid: false;
  reason: string;
}

export type LogValidationResult = ValidationSuccess | ValidationFailure;

export interface IngestLogsResult {
  accepted: number;
  rejected: RejectedLog[];
}


export interface AttributeFilter {
  key: string;
  value: string;
}

export interface LogQueryFilters {
  service?: string;
  level?: LogLevel;
  since?: Date;
  until?: Date;
  q?: string;

  attributes: AttributeFilter[];

  limit: number;

  cursor?: LogCursor;
}

export interface LogCursor {
  timestamp: Date;
  id: string;
}

export interface LogQueryResult {
  logs: QueriedLog[];
  nextCursor: string | null;
}

export interface QueriedLog {
  id: string;
  timestamp: Date;
  level: LogLevel;
  service: string;
  message: string;
  attributes: LogAttributes;
}