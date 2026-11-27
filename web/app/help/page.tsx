import { DocPage } from "@/components/DocPage";
export const metadata = { title: "Help · Fungu", description: "How to lend to a friend, run a chama, record cash or mobile-money repayments, and restore Fungu on a new phone.", alternates: { canonical: "/help" } };
const Q = ({ q, children }: { q: string; children: React.ReactNode }) => <><h2>{q}</h2><p>{children}</p></>;
export default function Page() {
  return (
    <DocPage title="Help" lede="Short answers to what people ask most.">
      <Q q="How do I lend to a friend">Open the app, tap Lend to a friend, type their @name, the amount, what it is for and the due date. They see the exact wording and accept it. Then you send the money.</Q>
      <Q q="Can someone guarantee a loan">Yes. Add a guarantor when you write the terms. They see the same wording and co-sign before your friend accepts.</Q>
      <Q q="My friend paid me in cash or mobile money">Open the debt and record the payment. Only the person who was owed can confirm a payment made outside the app.</Q>
      <Q q="How does a chama work here">Set the amount, how often, the number of members and a small refundable bond. Share the invite link. When everyone has paid, or the round ends, the pot goes to the next member in turn.</Q>
      <Q q="I forgot my PIN">On the lock screen tap Forgot your PIN, then restore from your WhatsApp backup. Without a backup or your backup key, nobody can recover the wallet.</Q>
      <Q q="I got a new phone">Open Fungu, choose I already have Fungu on another phone, and restore with your WhatsApp number or your backup key.</Q>
      <Q q="Does Fungu cost anything">No. Fungu pays the network fees. It runs on Solana devnet with test dollars for now.</Q>
      <p className="meta">Still stuck? Open an issue on <a href="https://github.com/ken-muritu/Fungu/issues">GitHub</a>.</p>
    </DocPage>
  );
}
