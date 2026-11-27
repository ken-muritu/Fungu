import { DocPage } from "@/components/DocPage";
export const metadata = { title: "Terms · Fungu", description: "The plain terms for using Fungu: a record-keeping tool between people, not a lender.", alternates: { canonical: "/terms" } };
export default function Page() {
  return (
    <DocPage title="Terms" lede="Plain terms for using Fungu. Last updated 27 November 2026.">
      <h2>Fungu is a tool, not a lender</h2>
      <p>Fungu helps people record and settle what they agree between themselves. Daelus never lends, never holds your debts, and is not a party to any agreement you make.</p>
      <h2>Test network</h2>
      <p>Fungu runs on Solana devnet with test dollars (fUSD) that have no value. Don&apos;t treat devnet balances as real money.</p>
      <h2>Your keys, your responsibility</h2>
      <p>You hold your wallet key. If you lose your phone, your PIN and your backup, nobody, including Daelus, can recover it.</p>
      <h2>Agreements between people</h2>
      <p>What you agree with a friend or a chama is between you. Fungu records it faithfully but does not enforce repayment, charge penalties or collect debts.</p>
      <h2>Fair use</h2>
      <p>Don&apos;t use Fungu to deceive people, launder money or break the law. We may rate-limit or block abuse of our servers.</p>
      <h2>Open source</h2>
      <p>The app is licensed under AGPL-3.0, and the on-chain program and SDK under Apache-2.0. The software is provided as is, without warranty.</p>
    </DocPage>
  );
}
