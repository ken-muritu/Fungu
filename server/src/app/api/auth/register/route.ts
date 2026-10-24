import { after } from "next/server";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { hashPin, signToken } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { z } from "zod";

const schema = z.object({
  phone: z.string().regex(/^\+254\d{9}$/, "Expected format +254712345678"),
  name: z.string().min(1).max(100),
  pin: z.string().regex(/^\d{4,6}$/, "PIN must be 4-6 digits"),
});

export async function POST(req: Request) {
  const body = schema.safeParse(await req.json());
  if (!body.success) {
    after(() => logEvent({ source: "server", eventType: "server_event", eventName: "register_validation_failed" }));
    return Response.json({ error: body.error.flatten() }, { status: 400 });
  }
  const { phone, name, pin } = body.data;

  const existing = await db.query.users.findFirst({ where: eq(users.phone, phone) });
  if (existing) {
    after(() => logEvent({ source: "server", eventType: "server_event", eventName: "register_duplicate_phone" }));
    return Response.json({ error: "An account with this phone number already exists" }, { status: 409 });
  }

  const id = nanoid();
  await db.insert(users).values({
    id,
    phone,
    name,
    pinHash: await hashPin(pin),
    createdAt: new Date(),
  });

  // Logging moved to run via after() rather than being awaited — every
  // route previously blocked its user-facing response on this extra DB
  // round trip. Real, measured impact: a debt-creation request that should
  // take well under a second was taking 14-15s in production (found via
  // the logs themselves), timing out client-side and causing a genuine
  // duplicate debt. after() runs this post-response, on Vercel's
  // guarantee that the function stays alive to finish it — a plain
  // un-awaited promise has no such guarantee and risks being killed
  // mid-write the moment the response is sent.
  after(() => logEvent({ userId: id, source: "server", eventType: "server_event", eventName: "user_registered" }));

  return Response.json({ token: signToken(id), user: { id, phone, name } }, { status: 201 });
}
