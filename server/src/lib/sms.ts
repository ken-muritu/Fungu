// Africa's Talking SMS — raw REST, same pattern as lib/mpesa.ts (no SDK
// dependency; this is a thin wrapper, not worth a package for it).
//
// Sandbox vs live is driven entirely by AT_USERNAME: their own SDK switches
// base domain purely on `username.toLowerCase() === 'sandbox'` (verified
// against africastalking-node.js's lib/common.js + lib/index.js) — there's
// no separate "env" flag to set. Use username 'sandbox' + your app's
// sandbox API key (both free, from your AT dashboard) for testing; no
// payment required. A live app also starts pre-loaded with a small free
// test balance (Ksh 10 for Kenya) per Africa's Talking's own account-setup
// guide, so an initial real-delivery test doesn't require topping up either.
//
// Docs note: developers.africastalking.com blocks AI crawlers via
// robots.txt (Disallow: ClaudeBot, by name) behind a Cloudflare challenge —
// this was NOT scraped around. Everything here comes from Africa's
// Talking's own public, unrestricted GitHub repos: the official Node.js
// SDK source (AfricasTalkingLtd/africastalking-node.js) and their
// account-setup guide (AfricasTalkingLtd/africastalking-devresources).

const BASE_URL = (process.env.AT_USERNAME ?? "").toLowerCase() === "sandbox"
  ? "https://api.sandbox.africastalking.com/version1"
  : "https://api.africastalking.com/version1";

export interface SmsResult {
  recipients: Array<{
    number: string;
    status: string; // e.g. "Success"
    statusCode: number;
    cost: string;
    messageId: string;
  }>;
}

/** Sends a single SMS via Africa's Talking. `to` must be E.164
 *  (+254712345678 — matches how phone numbers are already stored in the
 *  users/guarantorInvites tables, no conversion needed). Throws on any
 *  non-2xx response or a per-message API-level failure. */
export async function sendSms(params: { to: string; message: string }): Promise<SmsResult> {
  const username = process.env.AT_USERNAME;
  const apiKey = process.env.AT_API_KEY;
  if (!username || !apiKey) {
    throw new Error("AT_USERNAME / AT_API_KEY not configured");
  }

  const body = new URLSearchParams({
    username,
    to: params.to,
    message: params.message,
  });
  // Optional alphanumeric sender ID, registered with your AT account — the
  // sandbox app doesn't need or support one, so this is left unset unless
  // explicitly configured.
  if (process.env.AT_SENDER_ID) {
    body.set("from", process.env.AT_SENDER_ID);
  }

  const res = await fetch(`${BASE_URL}/messaging`, {
    method: "POST",
    headers: {
      apikey: apiKey,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  // Africa's Talking's messaging endpoint returns 201 Created on success,
  // not 200 — confirmed directly in their SDK source (called out there too
  // as a surprising choice, so this isn't a guess).
  const data = await res.json();
  if (res.status !== 201) {
    throw new Error(`Africa's Talking SMS send failed: ${res.status} ${JSON.stringify(data)}`);
  }

  const recipients = data?.SMSMessageData?.Recipients ?? [];
  const failed = recipients.filter((r: { status: string }) => r.status !== "Success");
  if (recipients.length > 0 && failed.length === recipients.length) {
    throw new Error(`Africa's Talking SMS rejected by carrier: ${JSON.stringify(failed)}`);
  }

  return {
    recipients: recipients.map((r: any) => ({
      number: r.number,
      status: r.status,
      statusCode: r.statusCode,
      cost: r.cost,
      messageId: r.messageId,
    })),
  };
}
