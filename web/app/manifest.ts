import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: "Fungu",
    short_name: "Fungu",
    description: "Debts and chamas between friends, kept honest.",
    start_url: "/app?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f4f6f9",
    theme_color: "#0f1a2b",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Lend to a friend", url: "/app?tab=debts", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "My chamas", url: "/app?tab=chamas", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
