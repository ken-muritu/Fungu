import { Logo, Ring } from "@/components/Brand";

const PROGRAM = "6NtCwcAU57GGeLCKQcJCgnk9Nzu9892jdQFDUaM2T4bE";

export default function Home() {
  return (
    <>
      <header className="top">
        <div className="wrap">
          <Logo />
          <nav className="nav">
            <a className="navlink hide-sm" href="#how">How it works</a>
            <a className="navlink hide-sm" href="#chamas">Chamas</a>
            <a className="navlink hide-sm" href="/security">Security</a>
            <a className="btn small" href="/app">Open app</a>
          </nav>
        </div>
      </header>

      <main>
        <section className="hero wrap">
          <div className="hero-copy">
            <span className="kicker">Debts and chamas, kept honest</span>
            <h1>Lend to friends without losing them<span className="dot">.</span></h1>
            <p className="lead">Fungu writes down what was agreed, who owes what and when, then lets the money settle phone to phone. No awkward reminders, no lost notebooks, no treasurer to trust blindly.</p>
            <div className="cta">
              <a className="btn" href="/app">Open Fungu</a>
              <a className="btn ghost" href="#how">See how it works</a>
            </div>
            <p className="small" style={{ marginTop: 18 }}>Free to try on Solana devnet with test dollars. Locked with your PIN or fingerprint.</p>
          </div>
          <figure className="hero-art" aria-label="Ken, a Fungu user, with two updates from the app">
            <img src="/ken-hero.webp" alt="Ken smiling, sitting forward" width={625} height={900} fetchPriority="high" />
            <div className="float f1"><Ring value={2 / 3} size={34} stroke={5} /><div><b>@otieno paid 1,000</b><span>2 of 3 portions · due 11 Dec</span></div></div>
            <div className="float f2"><Ring value={1} size={34} stroke={5} /><div><b>Wamama wa Kahawa</b><span>Round 3 of 6 · everyone paid</span></div></div>
          </figure>
        </section>

        <section className="section wrap" id="how">
          <h2>A debt between friends, done properly</h2>
          <p className="sub">Most loans between friends go wrong in silence: vague terms, no date, and a reminder nobody wants to send. Fungu fixes the parts that hurt.</p>
          <div className="grid3">
            <div className="card"><div className="step">1 · Agree</div><h3>Same terms, both sides</h3><p>Amount, purpose and due date. Your friend accepts the exact wording, and it is sealed on-chain so neither of you can change it later.</p></div>
            <div className="card"><div className="step">2 · Back it</div><h3>An optional guarantor</h3><p>Ask someone you both trust to co-sign. They see the same terms and say yes or no.</p></div>
            <div className="card"><div className="step">3 · Settle</div><h3>Pay in portions</h3><p>Repay in parts, wallet to wallet. Paid in cash or mobile money? The lender confirms it and it counts.</p></div>
          </div>
          <div className="grid2">
            <div className="card"><h3>Reminders without shame</h3><p>When a date passes, the debt is quietly flagged overdue. No penalties, no red letters, no collectors.</p></div>
            <div className="card"><h3>Forgiveness is a feature</h3><p>A lender can let the rest go. Nothing bad is written against the borrower.</p></div>
          </div>
        </section>

        <section className="section wrap" id="chamas">
          <h2>Chamas where the rules run themselves</h2>
          <p className="sub">A merry-go-round only works if everyone keeps paying after their turn. Fungu holds the pot in a vault that follows the group's rules, and nobody else can touch it.</p>
          <div className="grid3">
            <div className="card"><div className="step">Contribute</div><h3>Same amount, every round</h3><p>Members pay into the pot. Everyone can see who has paid, without a treasurer's spreadsheet.</p></div>
            <div className="card"><div className="step">Rotate</div><h3>Payout in turn</h3><p>When everyone has paid, or the round's time is up, the pot goes to the next member in line. Anyone can trigger it.</p></div>
            <div className="card"><div className="step">Protect</div><h3>A bond against walking away</h3><p>Each member stakes a small refundable bond. Miss a round after you've been paid, and your share comes from your own bond, not your friends' pockets.</p></div>
          </div>
        </section>

        <section className="section wrap" id="trust">
          <div className="grid2" style={{ marginTop: 0, alignItems: "center" }}>
            <div>
              <h2>Your money stays yours</h2>
              <p className="sub">Fungu is a ledger, not a lender. We never lend, never hold your debts, and have no key that can move a chama&apos;s pot.</p>
            </div>
            <div className="card stack">
              <div className="item"><Ring value={1} /><div className="grow"><strong>You hold your key.</strong> Your wallet is created on your phone. Our servers never see it.</div></div>
              <div className="item"><Ring value={1} /><div className="grow"><strong>No admin key.</strong> Only the program&apos;s rules can move chama money, and only to members.</div></div>
              <div className="item"><Ring value={1} /><div className="grow"><strong>No personal data on-chain.</strong> Terms are stored as a fingerprint; names and numbers stay with you.</div></div>
              <div className="item"><Ring value={1} /><div className="grow"><strong>Open source.</strong> Anyone can read the <a href={`https://explorer.solana.com/address/${PROGRAM}?cluster=devnet`}>program</a> and the <a href="https://github.com/ken-muritu/Fungu">code</a>.</div></div>
            </div>
          </div>
        </section>

        <section className="section wrap">
          <p className="quote">&ldquo;Debt is like fire. It can cook a meal or burn the house down.&rdquo;</p>
          <p className="small">Fungu exists for the first kind.</p>
        </section>

        <section className="section wrap faq" id="faq">
          <h2>Questions</h2>
          <details><summary>Is Fungu a loan app?</summary><p>No. Fungu never lends money and never decides who gets credit. It records what friends agree between themselves and helps them settle it.</p></details>
          <details><summary>Do I need crypto or SOL?</summary><p>No. Fungu pays the network fees for you. Today the app runs on Solana devnet with free test dollars (fUSD), so nothing real is at stake while you try it.</p></details>
          <details><summary>What if my friend pays me in cash or mobile money?</summary><p>Record it. Only the person who was owed can confirm a repayment made outside the app, so nobody can fake one.</p></details>
          <details><summary>Is there a credit score?</summary><p>No. Each wallet has a simple public record (debts settled on time, chama cycles completed) that you can choose to show. Nothing is sold or reported to a credit bureau.</p></details>
          <details><summary>Where is the money in a chama?</summary><p>In a vault controlled by the chama&apos;s rules on Solana. It can only go to members: payouts in turn, and bonds back at the end.</p></details>
        </section>
      </main>

      <footer className="foot">
        <div className="wrap">
          <span>© 2026 Fungu, by Daelus · Nairobi</span>
          <nav className="footnav" aria-label="Footer">
            <a href="/security">Security</a><a href="/help">Help</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a>
            <a href={`https://explorer.solana.com/address/${PROGRAM}?cluster=devnet`}>Program</a><a href="https://github.com/ken-muritu/Fungu">Source</a>
          </nav>
        </div>
      </footer>
    </>
  );
}
