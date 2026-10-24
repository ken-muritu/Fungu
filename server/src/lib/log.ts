import { db } from "@/db/client";
import { eventLogs } from "@/db/schema";
import { nanoid } from "nanoid";

// Keys that must never end up in a logged `detail` blob, however an event
// got constructed — a credential in a durable, queryable log table is a
// much bigger exposure than one in transient console output. Scrubbed
// recursively so a nested object (e.g. a whole request body passed as
// detail) can't sneak one through.
const SENSITIVE_KEYS = new Set(["pin", "pinhash", "pin_hash", "token", "authorization", "password"]);

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? "[redacted]" : scrub(v);
    }
    return out;
  }
  return value;
}

export interface LogEventParams {
  userId?: string | null;
  sessionId?: string | null;
  source: "client" | "server";
  platform?: string | null;
  appVersion?: string | null;
  eventType: "app_lifecycle" | "screen_view" | "user_action" | "api_call" | "error" | "server_event";
  eventName: string;
  detail?: Record<string, unknown> | null;
}

/** Fire-and-forget by design at call sites (never awaited where it would
 *  block a user-facing response) — logging must never be the reason a real
 *  request fails or feels slow. Errors here are caught and swallowed, not
 *  rethrown; the worst case is a missing log row, not a broken feature. */
export async function logEvent(params: LogEventParams): Promise<void> {
  try {
    await db.insert(eventLogs).values({
      id: nanoid(),
      userId: params.userId ?? null,
      sessionId: params.sessionId ?? null,
      source: params.source,
      platform: params.platform ?? null,
      appVersion: params.appVersion ?? null,
      eventType: params.eventType,
      eventName: params.eventName,
      detail: params.detail ? JSON.stringify(scrub(params.detail)) : null,
      createdAt: new Date(),
    });
  } catch (e) {
    console.error("logEvent failed (non-fatal)", params.eventName, e);
  }
}
