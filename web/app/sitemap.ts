import type { MetadataRoute } from "next";
const B = "https://fungu.daelus.co.ke";
export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/app", "/security", "/help", "/privacy", "/terms"].map((p) => ({ url: B + p, lastModified: new Date("2026-11-27") }));
}
