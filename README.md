# Fungu

**Lend to friends without losing them.** Fungu writes down what was agreed between friends or in a chama, who owes what and by when, and lets the money settle phone to phone on Solana. Fungu never lends and never holds your money.

**Live:** [fungu.daelus.co.ke](https://fungu.daelus.co.ke) · **App:** [fungu.daelus.co.ke/app](https://fungu.daelus.co.ke/app) (installable PWA) · Solana **devnet**, free test dollars (fUSD)

Name: *fungu* is Swahili for share, portion, instalment.

## What it does

- **Debts between friends.** The lender writes the terms. The borrower accepts the exact wording, which is stored on-chain as a hash, and an optional guarantor co-signs. Money goes wallet to wallet. Repay in portions, with no overpayment. The lender can confirm a cash or mobile-money repayment (only the lender, so nobody can fake one). Overdue is a quiet flag, never a penalty, and the lender can forgive the rest.
- **Chamas (2 to 12 members).** A fixed contribution each round, with the payout rotating in join order. Anyone can trigger a payout once everyone has paid or time is up. Each member stakes a refundable bond, so a member who walks away after being paid is covered from their own bond. The pot sits in a vault with **no admin key**.
- **@names.** Claim `@wanjiru` on-chain and friends can lend to you without copying an address.
- **Shilling estimates.** Balances show an approximate KSh value from a live USD→KES rate.
- **Gasless.** Fungu sponsors every network fee. You don't need SOL or crypto knowledge.
- **A public record, not a credit score.** It counts debts settled on time or late and chama cycles completed.

## Security

Your key is created on your phone and never leaves it. Details are at [fungu.daelus.co.ke/security](https://fungu.daelus.co.ke/security).

- **PIN lock:** PBKDF2-SHA256 (310k rounds) then AES-GCM. Back-off doubles after 5 wrong PINs, and the app auto-locks.
- **Fingerprint or face unlock:** a WebAuthn passkey with the PRF extension, then HKDF and AES-GCM.
- **WhatsApp backup:** the backup is encrypted on the phone before upload. The server stores only a keyed HMAC of your number. Restore codes are delivered over WhatsApp and rate-limited.
- **Authenticator (TOTP, RFC 6238):** an optional second step for restore. 5 wrong codes lock restore for an hour.
- **Bot checks:** Cloudflare Turnstile guards name claims and code requests.

## On Solana (devnet)

| | |
|---|---|
| Program | [`6NtCwcAU57GGeLCKQcJCgnk9Nzu9892jdQFDUaM2T4bE`](https://explorer.solana.com/address/6NtCwcAU57GGeLCKQcJCgnk9Nzu9892jdQFDUaM2T4bE?cluster=devnet) (Anchor) |
| Source | [`programs/fungu/src/lib.rs`](programs/fungu/src/lib.rs), built and deployed by [`solana.yml`](.github/workflows/solana.yml) |
| SDK | [`sdk/`](sdk): IDL, types and an end-to-end test against the live program |

## Code

- [`web/`](web): the Fungu site and app (Next.js 15, React 19, `@solana/web3.js`), hosted on Vercel. The app pages are `/`, `/app`, `/security`, `/help`, `/privacy` and `/terms`. API routes: `/api/sponsor` (fee payer), `/api/rpc`, `/api/faucet`, `/api/recovery` (backup and restore) and `/api/rate`.
- [`programs/`](programs): the Anchor program.
- [`sdk/`](sdk): the client SDK and its e2e test.
- [`app/`](app) and [`server/`](server): the earlier Flutter + Next.js/Turso ledger (Aug 2026), which used M-Pesa STK Push. It is kept for history. That design routed payments through a business shortcode, which raised payment-service-provider questions (see [`MVP-PRD.md`](MVP-PRD.md) §6). The Solana version avoids this because money moves wallet to wallet.
- [`research/`](research), [`BRAINSTORM.md`](BRAINSTORM.md): market, regulatory and naming research.

## Tests

From `web/`, each suite runs against devnet and the live deployment:

```
node --import tsx scripts/app-e2e.mts                                   # 29 checks: debts, guarantors, repayments, chamas, bonds, @names
node --conditions=react-server --import tsx scripts/recovery-test.mts   # 19 checks: phone hashing, tickets, TOTP, lockouts
node scripts/pwa-check.mjs                                              # service worker + offline page
```

Program e2e (one debt plus a full 3-member chama): `cd sdk && npm install && SPONSOR_KEYPAIR=~/.config/solana/id.json npm run e2e`.

## Hackathon

Built for the Dev3pack Global Hackathon (27–29 Nov 2026). Built during the hackathon: the Solana program, SDK, web app, security layer and @names. The Flutter ledger in `app/` and `server/` came before it.

## Licence

The app and server are under [GNU AGPL v3.0](LICENSE). The Solana program and SDK are under Apache 2.0. The Fungu name and logo are trademarks and are not licensed. See [NOTICE](NOTICE). Line icons are from [Lucide](https://lucide.dev) (ISC).
