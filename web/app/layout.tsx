import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import "./globals.css";
import { Pwa } from "@/components/Pwa";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", weight: ["600", "700", "800"] });
const sans = Figtree({ subsets: ["latin"], variable: "--font-sans", weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://fungu.daelus.co.ke"),
  title: "Fungu: lend to friends without losing them",
  description: "Honest records for money between friends and chamas: clear terms, repay in portions, guarantors and rotating payouts on Solana. Fungu never lends.",
  alternates: { canonical: "/" },
  appleWebApp: { capable: true, title: "Fungu", statusBarStyle: "default" },
  icons: { icon: "/icons/favicon-32.png", apple: "/icons/apple-touch-icon.png" },
  openGraph: { title: "Fungu", description: "Lend to friends without losing them. Debts and chamas, kept honest on Solana.", url: "https://fungu.daelus.co.ke", siteName: "Fungu", type: "website" },
  twitter: { card: "summary_large_image" },
};
export const viewport: Viewport = { themeColor: "#0f1a2b", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body>{children}<Pwa /></body>
    </html>
  );
}
