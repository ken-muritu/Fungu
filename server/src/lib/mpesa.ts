// Fungu Pay — Fungu's own name for this payment-forwarding layer, built on
// Safaricom Daraja STK Push (Lipa Na M-Pesa Online). Branding only for now:
// this is still the same C2B+B2C mechanism, still needs the lawyer
// confirmation below before real money moves through it, and "Fungu Pay"
// does NOT imply any payment-service licensing has been pursued — see the
// MVP-PRD.md §6 update and the AskUserQuestion decision it came from
// (branding-only, not a PSP-licensing commitment).
//
// IMPORTANT — read before wiring this to production, see also MVP-PRD.md §6:
// Daraja's public STK Push API (CustomerPayBillOnline) can only push a PIN
// prompt that pays INTO A REGISTERED BUSINESS SHORTCODE (PartyB). There is
// no public Daraja endpoint that triggers a personal-to-personal M-Pesa
// "Send Money" prompt between two arbitrary phone numbers on a third
// party's behalf. That means the "never touch funds" regulatory framing in
// the PRD needs revisiting: to use STK Push at all, a borrower's payment
// necessarily lands in FUNGU'S OWN till/paybill first, and getting it to
// the lender requires a second, separate B2C ("Business to Customer")
// disbursement call. Funds transit a Fungu-controlled account, even if only
// for seconds — that's functionally a payment-facilitation role, not a pure
// ledger. This likely shifts the real regulatory question from "are we a
// digital credit provider" toward "do we need Payment Service Provider
// treatment under the National Payment System Act" — a DIFFERENT question
// than the one flagged in BRAINSTORM.md, and one that also needs a lawyer's
// read before this goes anywhere near real money.
//
// This file implements the technically-correct C2B + B2C pattern (the only
// way STK Push actually works for a third-party app). It is NOT a
// workaround for the regulatory point above — it's the honest mechanics.

const BASE_URL = process.env.MPESA_ENV === "production"
  ? "https://api.safaricom.co.ke"
  : "https://sandbox.safaricom.co.ke";

async function getAccessToken(): Promise<string> {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) {
    throw new Error("MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET not configured");
  }
  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const res = await fetch(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (!res.ok) throw new Error(`Daraja auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export interface StkPushResult {
  merchantRequestId: string;
  checkoutRequestId: string;
  responseCode: string;
  customerMessage: string;
}

/** Prompts `phoneNumber` (the borrower) for their M-Pesa PIN to pay `amountKes`
 *  into Fungu's own shortcode. Repayment status stays "pending" until the
 *  callback confirms it — see /api/mpesa/callback. */
export async function initiateStkPush(params: {
  phoneNumber: string; // borrower, format 2547XXXXXXXX (no leading +)
  amountKes: number;
  accountReference: string; // e.g. debt id, shown on the borrower's phone
  transactionDesc: string;
  callbackUrl: string;
}): Promise<StkPushResult> {
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  if (!shortcode || !passkey) {
    throw new Error("MPESA_SHORTCODE / MPESA_PASSKEY not configured");
  }
  const token = await getAccessToken();
  const ts = timestamp();
  const password = Buffer.from(`${shortcode}${passkey}${ts}`).toString("base64");

  const res = await fetch(`${BASE_URL}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: ts,
      TransactionType: "CustomerPayBillOnline",
      Amount: Math.round(params.amountKes),
      PartyA: params.phoneNumber,
      PartyB: shortcode,
      PhoneNumber: params.phoneNumber,
      CallBackURL: params.callbackUrl,
      AccountReference: params.accountReference,
      TransactionDesc: params.transactionDesc,
    }),
  });
  const data = await res.json();
  if (!res.ok || data.ResponseCode !== "0") {
    throw new Error(`STK push failed: ${JSON.stringify(data)}`);
  }
  return {
    merchantRequestId: data.MerchantRequestID,
    checkoutRequestId: data.CheckoutRequestID,
    responseCode: data.ResponseCode,
    customerMessage: data.CustomerMessage,
  };
}

export interface StkCallbackResult {
  checkoutRequestId: string;
  success: boolean;
  amountKes?: number;
  mpesaReceiptNumber?: string;
  resultDesc: string;
}

/** Parses Daraja's callback POST body (see /api/mpesa/callback route). */
export function parseStkCallback(body: any): StkCallbackResult {
  const cb = body?.Body?.stkCallback;
  if (!cb) throw new Error("Malformed Daraja callback body");
  const success = cb.ResultCode === 0;
  let amountKes: number | undefined;
  let mpesaReceiptNumber: string | undefined;
  if (success) {
    const items: Array<{ Name: string; Value: unknown }> = cb.CallbackMetadata?.Item ?? [];
    amountKes = items.find((i) => i.Name === "Amount")?.Value as number | undefined;
    mpesaReceiptNumber = items.find((i) => i.Name === "MpesaReceiptNumber")?.Value as string | undefined;
  }
  return {
    checkoutRequestId: cb.CheckoutRequestID,
    success,
    amountKes,
    mpesaReceiptNumber,
    resultDesc: cb.ResultDesc,
  };
}

/** Forwards a confirmed payment on to the lender's phone via Daraja's B2C
 *  API. This is the step that actually completes peer-to-peer settlement —
 *  and the step that makes the "never hold funds" framing inexact, since it
 *  necessarily runs AFTER Fungu has received the money via STK Push above. */
export async function disburseToLender(params: {
  phoneNumber: string; // lender
  amountKes: number;
  remarks: string;
  resultUrl: string;
  queueTimeoutUrl: string;
}): Promise<{ conversationId: string }> {
  const shortcode = process.env.MPESA_SHORTCODE;
  const initiatorName = process.env.MPESA_INITIATOR_NAME;
  const securityCredential = process.env.MPESA_SECURITY_CREDENTIAL; // encrypted initiator password, see Daraja docs
  if (!shortcode || !initiatorName || !securityCredential) {
    throw new Error("MPESA_INITIATOR_NAME / MPESA_SECURITY_CREDENTIAL not configured");
  }
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}/mpesa/b2c/v1/paymentrequest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      InitiatorName: initiatorName,
      SecurityCredential: securityCredential,
      CommandID: "BusinessPayment",
      Amount: Math.round(params.amountKes),
      PartyA: shortcode,
      PartyB: params.phoneNumber,
      Remarks: params.remarks,
      QueueTimeOutURL: params.queueTimeoutUrl,
      ResultURL: params.resultUrl,
      Occasion: "Fungu debt repayment",
    }),
  });
  const data = await res.json();
  if (!res.ok || data.ResponseCode !== "0") {
    throw new Error(`B2C disbursement failed: ${JSON.stringify(data)}`);
  }
  return { conversationId: data.ConversationID };
}
