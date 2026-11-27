// USD → KES for the "≈ KSh" estimate. Free source (open.er-api.com, daily rates), cached 6 hours.
export const revalidate = 21600;
export async function GET() {
  try {
    const j = await fetch("https://open.er-api.com/v6/latest/USD", { next: { revalidate: 21600 } }).then((r) => r.json());
    const kes = Number(j?.rates?.KES);
    if (j?.result !== "success" || !(kes > 50 && kes < 500)) throw new Error("bad rate");
    return Response.json({ kes, asOf: j.time_last_update_utc, source: "open.er-api.com" });
  } catch {
    return Response.json({ kes: null }, { status: 503 });
  }
}
