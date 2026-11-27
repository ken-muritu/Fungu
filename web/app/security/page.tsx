import { DocPage } from "@/components/DocPage";
export const metadata = { title: "How Fungu keeps your money safe", description: "Your key never leaves your phone. PIN or fingerprint lock, encrypted WhatsApp backup, authenticator codes and an open-source program with no admin key.", alternates: { canonical: "/security" } };
export default function Page() {
  return (
    <DocPage title="How Fungu keeps your money safe" lede="Fungu is built so that nobody, including us, can move your money or read your agreements.">
      <h2>Your key stays on your phone</h2>
      <p>Your wallet is created on your device. Its key is encrypted with your 6-digit PIN (PBKDF2, 310,000 rounds, then AES-GCM) and never sent to our servers. After five wrong PINs the app makes you wait, and the wait doubles each time.</p>
      <h2>Fingerprint unlock</h2>
      <p>On phones that support it, you can unlock with your fingerprint or face. The key is sealed with a secret your phone&apos;s passkey releases only after it checks you. Your fingerprint itself never leaves the phone.</p>
      <h2>Back up with WhatsApp</h2>
      <p>If you lose your phone, you can restore with a code sent to your WhatsApp. Your backup is encrypted on your phone before it is uploaded, so the stored copy is unreadable on its own. We keep only a one-way fingerprint of your number, never the number itself.</p>
      <h2>Authenticator codes</h2>
      <p>Add Google Authenticator or any TOTP app as a second step. Then restoring needs both the WhatsApp code and the 6-digit authenticator code. Five wrong codes lock restore for an hour.</p>
      <h2>No admin key, open source</h2>
      <p>The Fungu program on Solana has no owner override. Only its rules can move chama money, and only to members. The <a href="https://github.com/ken-muritu/Fungu">code is public</a> so anyone can check.</p>
      <h2>Today: devnet</h2>
      <p>Fungu currently runs on Solana devnet with test dollars (fUSD). Nothing real is at stake while you try it.</p>
    </DocPage>
  );
}
