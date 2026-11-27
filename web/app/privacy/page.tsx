import { DocPage } from "@/components/DocPage";
export const metadata = { title: "Privacy · Fungu", description: "What Fungu stores, what it never sees, and the services it uses.", alternates: { canonical: "/privacy" } };
export default function Page() {
  return (
    <DocPage title="Privacy" lede="Fungu collects as little as it can. Last updated 27 November 2026.">
      <h2>What stays on your phone</h2>
      <p>Your wallet key (encrypted), your PIN settings, the names you give friends, and the full wording of your agreements.</p>
      <h2>What is public on Solana</h2>
      <p>Wallet addresses, amounts, due dates, repayments, chama rounds, your @name if you claim one, and a fingerprint (hash) of each agreement&apos;s wording. The wording itself is not on-chain.</p>
      <h2>What our server keeps</h2>
      <p>Only if you turn on WhatsApp backup: a keyed one-way fingerprint of your phone number, your backup encrypted on your phone before upload, and, if you add one, your authenticator secret sealed with a server key. Codes expire within minutes.</p>
      <h2>Services we use</h2>
      <ul><li>Vercel hosts the site and app.</li><li>Turso stores the encrypted backups.</li><li>A WhatsApp sender delivers restore codes.</li><li>Cloudflare Turnstile checks for bots when you claim a name or ask for a code.</li><li>open.er-api.com supplies the shilling estimate.</li></ul>
      <h2>No tracking, no selling</h2>
      <p>No ads, no analytics cookies, and nothing is sold or reported to a credit bureau.</p>
      <h2>On-chain records are permanent</h2>
      <p>Nobody can delete records on Solana, which is why personal details never go there. To have your backup removed from our server, open an issue on <a href="https://github.com/ken-muritu/Fungu/issues">GitHub</a>.</p>
    </DocPage>
  );
}
