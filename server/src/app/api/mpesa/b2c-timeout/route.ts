// Daraja requires a QueueTimeOutURL for B2C requests. v1: log and acknowledge.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  console.error("B2C timeout", JSON.stringify(body));
  return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
}
