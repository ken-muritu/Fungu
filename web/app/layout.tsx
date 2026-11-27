import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

const display = Fraunces({ subsets: ["latin"], variable: "--font-display", weight: ["600"] });
const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  metadataBase: new URL("https://fungu.daelus.co.ke"),
  title: "Fungu: lend to friends without losing them",
  description: "Fungu keeps honest records of money between friends and in chamas: clear terms, partial repayments, guarantors and rotating payouts, settled on Solana. You hold your own money; Fungu never lends.",
  openGraph: { title: "Fungu", description: "Lend to friends without losing them. Debts and chamas, kept honest on Solana.", url: "https://fungu.daelus.co.ke", siteName: "Fungu" },
};
export const viewport: Viewport = { themeColor: "#fbf7f0", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
