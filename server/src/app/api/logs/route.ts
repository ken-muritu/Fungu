import { verifyToken } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import { z } from "zod";

const eventSchema = z.object({
  eventType: z.enum(["app_lifecycle", "screen_view", "user_action", "api_call", "error"]),
  eventName: z.string().min(1).max(200),
  detail: z.record(z.string(), z.unknown()).optional(),
  // Client sets its own timestamp too (detail.clientTimestamp elsewhere if
  // needed) — createdAt in the DB is always server-received time, which is
  // what matters for ordering across users/devices with clocks that may
  // not agree with each other.
});

const batchSchema = z.object({
  sessionId: z.string().optional(),
  platform: z.string().optional(),
  appVersion: z.string().optional(),
  events: z.array(eventSchema).min(1).max(100), // cap a single batch — a runaway client loop shouldn't be able to flood one request
});

// Deliberately tolerant of auth: most client events happen mid-session with
// a valid token, but some of the most diagnostically useful ones happen
// BEFORE a user is authenticated at all — a failed login, a register
// attempt that 409'd, an app crash on the splash screen. Those still need
// to be logged, just with userId left null rather than the whole request
// rejected.
function resolveUserId(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return verifyToken(auth.slice("Bearer ".length))?.sub ?? null;
}

export async function POST(req: Request) {
  const userId = resolveUserId(req);

  const body = batchSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  // Fire-and-forget each insert rather than awaiting sequentially — this
  // endpoint's whole point is to never be the slow/blocking part of the
  // app, and logEvent() already swallows its own errors.
  await Promise.all(
    body.data.events.map((e) =>
      logEvent({
        userId,
        sessionId: body.data.sessionId,
        source: "client",
        platform: body.data.platform,
        appVersion: body.data.appVersion,
        eventType: e.eventType,
        eventName: e.eventName,
        detail: e.detail,
      })
    )
  );

  return Response.json({ ok: true, received: body.data.events.length });
}
