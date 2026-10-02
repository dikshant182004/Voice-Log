/**
 * Structured JSON Logger for Cloudflare Workers Observability.
 * Emits log lines formatted for Cloudflare Dashboard filtering and metrics aggregation.
 * Never logs secrets, bearer tokens, or full transcript bodies.
 */

export type DomainEvent =
  | 'call.received'
  | 'call.persisted'
  | 'call.duplicate'
  | 'call.validation_failed'
  | 'call.eval_completed'
  | 'call.eval_failed'
  | 'call.eval_skipped';

export interface StructuredLogPayload {
  level: 'info' | 'warn' | 'error';
  timestamp: string;
  request_id: string;
  event?: DomainEvent;
  method?: string;
  route?: string;
  status?: number;
  duration_ms?: number;
  call_id?: string;
  error_code?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

export function logEvent(
  level: 'info' | 'warn' | 'error',
  requestId: string,
  event: DomainEvent,
  message: string,
  context: {
    callId?: string;
    route?: string;
    status?: number;
    metadata?: Record<string, unknown>;
    errorCode?: string;
  } = {}
) {
  const payload: StructuredLogPayload = {
    level,
    timestamp: new Date().toISOString(),
    request_id: requestId,
    event,
    message,
    call_id: context.callId,
    route: context.route,
    status: context.status,
    error_code: context.errorCode,
    metadata: context.metadata,
  };

  const serialized = JSON.stringify(payload);
  if (level === 'error') {
    console.error(serialized);
  } else if (level === 'warn') {
    console.warn(serialized);
  } else {
    console.log(serialized);
  }
}

export function logRequest(
  requestId: string,
  method: string,
  route: string,
  status: number,
  durationMs: number,
  callId?: string,
  errorCode?: string
) {
  const payload: StructuredLogPayload = {
    level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
    timestamp: new Date().toISOString(),
    request_id: requestId,
    method,
    route,
    status,
    duration_ms: Math.round(durationMs * 100) / 100,
    call_id: callId,
    error_code: errorCode,
  };

  const serialized = JSON.stringify(payload);
  if (payload.level === 'error') {
    console.error(serialized);
  } else if (payload.level === 'warn') {
    console.warn(serialized);
  } else {
    console.log(serialized);
  }
}
