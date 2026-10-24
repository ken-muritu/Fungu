import { after } from "next/server";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { verifyPin, signToken } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import { eq } from "drizzle-orm";
import { z } from "zod";

const schema = z.object({
  phone: z.string(),
  pin: z.string(),
});

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// Deliberately identical error for "no such user" and "wrong PIN" — don't
// leak which phone numbers have accounts (the lockout message a few lines
// down is a narrow, accepted exception to that, see its own comment).
// Wording nudges toward "check the number" specifically because of a real
// incident caught in event_logs: a tester mistyped their own number,
// got this error, and rather than retrying registered an entirely new
// (duplicate) account instead of realizing the typo — plain "incorrect
// phone or PIN" gave no hint which was more likely.
const WRONG_CREDENTIALS_MESSAGE =
  "Incorrect phone number or PIN — if you've registered before, double-check the number you typed.";

export async function POST(req: Request) {
  const body = schema.safeParse(await req.json());
  if (!body.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const { phone, pin } = body.data;

  const user = await db.query.users.findFirst({ where: eq(users.phone, phone) });

  if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    after(() =>
      logEvent({ userId: user.id, source: "server", eventType: "server_event", eventName: "login_rejected_locked" })
    );
    return Response.json(
      { error: `Too many wrong attempts — try again in ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}` },
      { status: 429 }
    );
  }

  const valid = user ? await verifyPin(pin, user.pinHash) : false;

  if (!user || !valid) {
    if (user) {
      const attempts = user.failedLoginAttempts + 1;
      const locked = attempts >= MAX_FAILED_ATTEMPTS;
      await db
        .update(users)
        .set({
          failedLoginAttempts: attempts,
          lockedUntil: locked ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
        })
        .where(eq(users.id, user.id));
      after(() =>
        logEvent({
          userId: user.id,
          source: "server",
          eventType: "server_event",
          eventName: locked ? "login_failed_now_locked" : "login_failed",
          detail: { attempts },
        })
      );
    } else {
      after(() => logEvent({ source: "server", eventType: "server_event", eventName: "login_unknown_phone" }));
    }
    return Response.json({ error: WRONG_CREDENTIALS_MESSAGE }, { status: 401 });
  }

  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    await db.update(users).set({ failedLoginAttempts: 0, lockedUntil: null }).where(eq(users.id, user.id));
  }

  after(() =>
    logEvent({ userId: user.id, source: "server", eventType: "server_event", eventName: "login_success" })
  );

  return Response.json({ token: signToken(user.id), user: { id: user.id, phone: user.phone, name: user.name } });
}
