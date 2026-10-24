// Daraja requires a ResultURL for B2C requests to POST to. v1: just log and
// acknowledge — reconciling B2C outcomes against repayments is a real
// operational need before production, not yet built (see MVP-PRD.md risks).
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  console.log("B2C result", JSON.stringify(body));
  return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
}
