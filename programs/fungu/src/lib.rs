//! Fungu: an honest on-chain ledger for debts between friends and for chamas
//! (rotating savings groups).
//!
//! Design rules (they keep Fungu a ledger, not a lender or a custodian):
//! - Debts never sit in a Fungu account. Funding and repayment go straight
//!   from one person's wallet to the other's.
//! - A chama's pot lives in a vault owned by the chama's own program address.
//!   There is no admin key: only the program rules can move it, and only to
//!   members.
//! - No personal data on-chain. Terms are stored as a hash; names and phone
//!   numbers stay off-chain.
//! - A separate `payer` signs for fees and rent on every instruction, so the
//!   app can sponsor fees and users never need SOL.
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

declare_id!("6NtCwcAU57GGeLCKQcJCgnk9Nzu9892jdQFDUaM2T4bE");

pub const MAX_MEMBERS: usize = 12;
pub const MAX_NAME: usize = 32;

#[program]
pub mod fungu {
    use super::*;

    // ---------------------------------------------------------------- profile

    /// One reputation record per wallet: counts of settled, on-time and late
    /// debts and completed chama cycles. Not a credit score; anyone can read it.
    pub fn init_profile(ctx: Context<InitProfile>) -> Result<()> {
        let p = &mut ctx.accounts.profile;
        p.owner = ctx.accounts.user.key();
        p.bump = ctx.bumps.profile;
        Ok(())
    }

    /// Claims a Fungu name (@name) for the signer. First come, first served; one name per
    /// wallet, permanent. Lower-case letters, digits and "_", 3-20 characters, starting with a letter.
    /// Two records make both directions a single lookup: name -> owner and owner -> name.
    pub fn register_name(ctx: Context<RegisterName>, name: String) -> Result<()> {
        let b = name.as_bytes();
        require!(b.len() >= 3 && b.len() <= 20, FunguError::InvalidName);
        require!(b[0].is_ascii_lowercase(), FunguError::InvalidName);
        require!(b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'_'), FunguError::InvalidName);
        let owner = ctx.accounts.user.key();
        let n = &mut ctx.accounts.name_record;
        n.owner = owner;
        n.name = name.clone();
        n.bump = ctx.bumps.name_record;
        let h = &mut ctx.accounts.handle;
        h.owner = owner;
        h.name = name;
        h.bump = ctx.bumps.handle;
        Ok(())
    }

    // ------------------------------------------------------------- agreements

    /// The lender proposes a debt. Nothing moves until the borrower accepts.
    pub fn create_agreement(
        ctx: Context<CreateAgreement>,
        id: u64,
        principal: u64,
        due_ts: i64,
        terms_hash: [u8; 32],
        guarantor: Option<Pubkey>,
    ) -> Result<()> {
        let lender = ctx.accounts.lender.key();
        let borrower = ctx.accounts.borrower.key();
        require!(principal > 0, FunguError::ZeroAmount);
        require!(due_ts > Clock::get()?.unix_timestamp, FunguError::DueInPast);
        require_keys_neq!(lender, borrower, FunguError::SelfAgreement);
        if let Some(g) = guarantor {
            require!(g != lender && g != borrower, FunguError::SelfGuarantee);
        }
        let a = &mut ctx.accounts.agreement;
        a.id = id;
        a.lender = lender;
        a.borrower = borrower;
        a.guarantor = guarantor;
        a.guarantor_signed = false;
        a.mint = ctx.accounts.mint.key();
        a.principal = principal;
        a.repaid = 0;
        a.due_ts = due_ts;
        a.terms_hash = terms_hash;
        a.status = AgreementStatus::Proposed;
        a.funded = false;
        a.overdue = false;
        a.created_at = Clock::get()?.unix_timestamp;
        a.closed_at = 0;
        a.bump = ctx.bumps.agreement;
        emit!(AgreementEvent { agreement: a.key(), kind: 0, amount: principal });
        Ok(())
    }

    /// The borrower agrees to the exact terms (the hash must match what they saw).
    pub fn accept_agreement(ctx: Context<BorrowerAction>, terms_hash: [u8; 32]) -> Result<()> {
        let a = &mut ctx.accounts.agreement;
        require!(a.status == AgreementStatus::Proposed, FunguError::WrongStatus);
        require!(a.terms_hash == terms_hash, FunguError::TermsMismatch);
        a.status = AgreementStatus::Active;
        emit!(AgreementEvent { agreement: a.key(), kind: 1, amount: 0 });
        Ok(())
    }

    /// The lender withdraws a proposal the borrower has not accepted yet.
    pub fn cancel_agreement(ctx: Context<LenderAction>) -> Result<()> {
        let a = &mut ctx.accounts.agreement;
        require!(a.status == AgreementStatus::Proposed, FunguError::WrongStatus);
        a.status = AgreementStatus::Cancelled;
        a.closed_at = Clock::get()?.unix_timestamp;
        emit!(AgreementEvent { agreement: a.key(), kind: 2, amount: 0 });
        Ok(())
    }

    /// The named guarantor co-signs, seeing the same terms.
    pub fn guarantor_cosign(ctx: Context<GuarantorAction>, terms_hash: [u8; 32]) -> Result<()> {
        let a = &mut ctx.accounts.agreement;
        require!(a.guarantor == Some(ctx.accounts.guarantor.key()), FunguError::NotGuarantor);
        require!(
            a.status == AgreementStatus::Proposed || a.status == AgreementStatus::Active,
            FunguError::WrongStatus
        );
        require!(a.terms_hash == terms_hash, FunguError::TermsMismatch);
        a.guarantor_signed = true;
        emit!(AgreementEvent { agreement: a.key(), kind: 3, amount: 0 });
        Ok(())
    }

    /// Optional: the lender sends the principal on-chain, wallet to wallet.
    /// (The money can also change hands off-chain, e.g. by mobile money.)
    pub fn fund_agreement(ctx: Context<FundAgreement>) -> Result<()> {
        let a = &ctx.accounts.agreement;
        require!(a.status == AgreementStatus::Active, FunguError::WrongStatus);
        require!(!a.funded, FunguError::AlreadyFunded);
        let amount = a.principal;
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.lender_ata.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.borrower_ata.to_account_info(),
                    authority: ctx.accounts.lender.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        let a = &mut ctx.accounts.agreement;
        a.funded = true;
        emit!(AgreementEvent { agreement: a.key(), kind: 4, amount });
        Ok(())
    }

    /// The borrower repays part or all of what is left, wallet to wallet.
    pub fn repay(ctx: Context<Repay>, amount: u64) -> Result<()> {
        let a = &ctx.accounts.agreement;
        require!(a.status == AgreementStatus::Active, FunguError::WrongStatus);
        require!(amount > 0, FunguError::ZeroAmount);
        require!(amount <= a.principal - a.repaid, FunguError::Overpayment);
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.borrower_ata.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.lender_ata.to_account_info(),
                    authority: ctx.accounts.borrower.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        apply_repayment(&mut ctx.accounts.agreement, &mut ctx.accounts.borrower_profile, amount, 5)
    }

    /// The lender confirms a repayment received off-chain (cash or mobile
    /// money). Only the lender can sign this, so a borrower can never claim
    /// a payment that the lender didn't receive. `receipt_hash` lets the app prove which
    /// mobile-money receipt it was without putting the receipt on-chain.
    pub fn confirm_offchain_repayment(
        ctx: Context<ConfirmOffchain>,
        amount: u64,
        receipt_hash: [u8; 32],
    ) -> Result<()> {
        let a = &ctx.accounts.agreement;
        require!(a.status == AgreementStatus::Active, FunguError::WrongStatus);
        require!(amount > 0, FunguError::ZeroAmount);
        require!(amount <= a.principal - a.repaid, FunguError::Overpayment);
        emit!(ReceiptEvent { agreement: a.key(), amount, receipt_hash });
        apply_repayment(&mut ctx.accounts.agreement, &mut ctx.accounts.borrower_profile, amount, 6)
    }

    /// Anyone can flag a debt as overdue once its due date passes. It is
    /// only a flag: no fees, no penalties.
    pub fn mark_overdue(ctx: Context<MarkOverdue>) -> Result<()> {
        let a = &mut ctx.accounts.agreement;
        require!(a.status == AgreementStatus::Active, FunguError::WrongStatus);
        require!(Clock::get()?.unix_timestamp > a.due_ts, FunguError::NotYetDue);
        a.overdue = true;
        emit!(AgreementEvent { agreement: a.key(), kind: 7, amount: a.principal - a.repaid });
        Ok(())
    }

    /// The lender forgives whatever is left. Nothing negative is recorded
    /// on the borrower's profile.
    pub fn forgive(ctx: Context<LenderAction>) -> Result<()> {
        let a = &mut ctx.accounts.agreement;
        require!(a.status == AgreementStatus::Active, FunguError::WrongStatus);
        a.status = AgreementStatus::Forgiven;
        a.closed_at = Clock::get()?.unix_timestamp;
        emit!(AgreementEvent { agreement: a.key(), kind: 8, amount: a.principal - a.repaid });
        Ok(())
    }

    // ----------------------------------------------------------------- chamas

    /// Start a chama: a fixed contribution each round, a rotating payout in
    /// join order, and a refundable bond each member stakes against missing
    /// a contribution after their own payout.
    pub fn create_chama(
        ctx: Context<CreateChama>,
        id: u64,
        name: String,
        contribution: u64,
        period_secs: i64,
        max_members: u8,
        bond: u64,
    ) -> Result<()> {
        require!(name.len() <= MAX_NAME, FunguError::NameTooLong);
        require!(contribution > 0, FunguError::ZeroAmount);
        require!(period_secs >= 60, FunguError::PeriodTooShort);
        require!(
            (2..=MAX_MEMBERS as u8).contains(&max_members),
            FunguError::BadMemberCount
        );
        let c = &mut ctx.accounts.chama;
        c.id = id;
        c.creator = ctx.accounts.creator.key();
        c.mint = ctx.accounts.mint.key();
        c.vault = ctx.accounts.vault.key();
        c.name = name;
        c.contribution = contribution;
        c.period_secs = period_secs;
        c.max_members = max_members;
        c.bond = bond;
        c.status = ChamaStatus::Forming;
        c.round = 0;
        c.round_start = 0;
        c.paid_mask = 0;
        c.members = Vec::new();
        c.bonds = Vec::new();
        c.defaults = Vec::new();
        c.bump = ctx.bumps.chama;
        emit!(ChamaEvent { chama: c.key(), kind: 0, member: c.creator, amount: 0 });
        Ok(())
    }

    /// Join while the chama is forming, staking the bond. The payout order is
    /// the join order. When the chama is full, round 1 starts.
    pub fn join_chama(ctx: Context<MemberMoney>) -> Result<()> {
        let member = ctx.accounts.member.key();
        let c = &ctx.accounts.chama;
        require!(c.status == ChamaStatus::Forming, FunguError::WrongStatus);
        require!(!c.members.contains(&member), FunguError::AlreadyMember);
        require!(c.members.len() < c.max_members as usize, FunguError::ChamaFull);
        let bond = c.bond;
        if bond > 0 {
            pay_into_vault(&ctx, bond)?;
        }
        let now = Clock::get()?.unix_timestamp;
        let c = &mut ctx.accounts.chama;
        c.members.push(member);
        c.bonds.push(bond);
        c.defaults.push(0);
        if c.members.len() == c.max_members as usize {
            c.status = ChamaStatus::Active;
            c.round_start = now;
        }
        emit!(ChamaEvent { chama: c.key(), kind: 1, member, amount: bond });
        Ok(())
    }

    /// Leave before the chama starts; the bond comes straight back.
    pub fn leave_chama(ctx: Context<MemberMoney>) -> Result<()> {
        let member = ctx.accounts.member.key();
        let c = &ctx.accounts.chama;
        require!(c.status == ChamaStatus::Forming, FunguError::WrongStatus);
        let i = member_index(c, &member)?;
        let bond = c.bonds[i];
        if bond > 0 {
            pay_from_vault(
                &ctx.accounts.chama,
                &ctx.accounts.vault,
                &ctx.accounts.member_ata,
                &ctx.accounts.mint,
                &ctx.accounts.token_program,
                bond,
            )?;
        }
        let c = &mut ctx.accounts.chama;
        c.members.remove(i);
        c.bonds.remove(i);
        c.defaults.remove(i);
        emit!(ChamaEvent { chama: c.key(), kind: 2, member, amount: bond });
        Ok(())
    }

    /// Pay this round's contribution into the pot.
    pub fn contribute(ctx: Context<MemberMoney>) -> Result<()> {
        let member = ctx.accounts.member.key();
        let c = &ctx.accounts.chama;
        require!(c.status == ChamaStatus::Active, FunguError::WrongStatus);
        let i = member_index(c, &member)?;
        require!(c.paid_mask & (1u16 << i) == 0, FunguError::AlreadyPaid);
        let amount = c.contribution;
        pay_into_vault(&ctx, amount)?;
        let c = &mut ctx.accounts.chama;
        c.paid_mask |= 1u16 << i;
        emit!(ChamaEvent { chama: c.key(), kind: 3, member, amount });
        Ok(())
    }

    /// Anyone can trigger the payout once every member has paid, or once the
    /// round's time is up. A member who missed the round is covered from
    /// their own bond and the miss is recorded. The pot goes to this round's
    /// member in join order.
    pub fn payout(ctx: Context<Payout>) -> Result<()> {
        let c = &ctx.accounts.chama;
        require!(c.status == ChamaStatus::Active, FunguError::WrongStatus);
        let n = c.members.len();
        let all_paid = c.paid_mask == ((1u32 << n) - 1) as u16;
        let now = Clock::get()?.unix_timestamp;
        require!(all_paid || now >= c.round_start + c.period_secs, FunguError::RoundNotOver);
        let recipient = c.members[c.round as usize];
        require_keys_eq!(ctx.accounts.recipient_ata.owner, recipient, FunguError::WrongOwner);

        let mut pot: u64 = 0;
        let mut bonds = c.bonds.clone();
        let mut defaults = c.defaults.clone();
        for j in 0..n {
            if c.paid_mask & (1u16 << j) != 0 {
                pot += c.contribution;
            } else {
                let cover = bonds[j].min(c.contribution);
                bonds[j] -= cover;
                pot += cover;
                defaults[j] = defaults[j].saturating_add(1);
            }
        }
        if pot > 0 {
            pay_from_vault(
                &ctx.accounts.chama,
                &ctx.accounts.vault,
                &ctx.accounts.recipient_ata,
                &ctx.accounts.mint,
                &ctx.accounts.token_program,
                pot,
            )?;
        }
        let c = &mut ctx.accounts.chama;
        c.bonds = bonds;
        c.defaults = defaults;
        c.round += 1;
        c.paid_mask = 0;
        c.round_start = now;
        if c.round as usize == n {
            c.status = ChamaStatus::Completed;
        }
        emit!(ChamaEvent { chama: c.key(), kind: 4, member: recipient, amount: pot });
        Ok(())
    }

    /// After the last round, each member takes back what is left of their bond
    /// and the cycle is written to their profile.
    pub fn withdraw_bond(ctx: Context<WithdrawBond>) -> Result<()> {
        let member = ctx.accounts.member.key();
        let c = &ctx.accounts.chama;
        require!(c.status == ChamaStatus::Completed, FunguError::WrongStatus);
        let i = member_index(c, &member)?;
        require!(c.bonds[i] != u64::MAX, FunguError::AlreadyWithdrawn);
        let amount = c.bonds[i];
        let missed = c.defaults[i] as u32;
        if amount > 0 {
            pay_from_vault(
                &ctx.accounts.chama,
                &ctx.accounts.vault,
                &ctx.accounts.member_ata,
                &ctx.accounts.mint,
                &ctx.accounts.token_program,
                amount,
            )?;
        }
        let c = &mut ctx.accounts.chama;
        c.bonds[i] = u64::MAX; // marks "withdrawn"
        let p = &mut ctx.accounts.profile;
        p.chama_cycles = p.chama_cycles.saturating_add(1);
        p.chama_missed = p.chama_missed.saturating_add(missed);
        emit!(ChamaEvent { chama: c.key(), kind: 5, member, amount });
        Ok(())
    }

    // ------------------------------------------------------------------ books
    // A Book is the money record of a chama, or of a debt between friends, kept
    // in KES (or any currency code). No tokens move. Each entry is a salted
    // hash of the off-chain record, chained into `root`, so nobody (not the
    // treasurer, not Fungu) can rewrite history unnoticed. Entries and rule
    // changes land only once `threshold` officials approve.

    /// Open a book. `officials` are the people whose approvals count (chair,
    /// treasurer, secretary; or lender and borrower for a debt).
    pub fn create_book(
        ctx: Context<CreateBook>,
        id: u64,
        officials: Vec<Pubkey>,
        threshold: u8,
        rules_hash: [u8; 32],
        currency: [u8; 3],
    ) -> Result<()> {
        require!(!officials.is_empty() && officials.len() <= MAX_OFFICIALS, FunguError::BadOfficials);
        require!(threshold >= 1 && (threshold as usize) <= officials.len(), FunguError::BadThreshold);
        for (i, o) in officials.iter().enumerate() {
            require!(!officials[..i].contains(o), FunguError::BadOfficials);
        }
        let creator = ctx.accounts.creator.key();
        require!(officials.contains(&creator), FunguError::NotOfficial);
        let b = &mut ctx.accounts.book;
        b.id = id;
        b.creator = creator;
        b.officials = officials;
        b.threshold = threshold;
        b.rules_hash = rules_hash;
        b.currency = currency;
        b.root = rules_hash;
        b.entries = 0;
        b.next_proposal = 0;
        b.created_at = Clock::get()?.unix_timestamp;
        b.bump = ctx.bumps.book;
        emit!(BookEvent { book: b.key(), kind: 0, seq: 0, entry_hash: rules_hash, amount: 0, root: b.root });
        Ok(())
    }

    /// Anyone proposes an entry (a contribution with its M-Pesa code hash, a
    /// payout, a repayment, a fine) or a rule change. An official proposer's
    /// approval counts at once.
    pub fn propose(ctx: Context<Propose>, kind: u8, entry_hash: [u8; 32], amount: u64) -> Result<()> {
        require!(kind >= 1 && kind <= ENTRY_KIND_MAX, FunguError::BadKind);
        let proposer = ctx.accounts.proposer.key();
        let b = &mut ctx.accounts.book;
        let p = &mut ctx.accounts.proposal;
        p.book = b.key();
        p.seq = b.next_proposal;
        p.proposer = proposer;
        p.kind = kind;
        p.entry_hash = entry_hash;
        p.amount = amount;
        p.approvals = 0;
        p.created_at = Clock::get()?.unix_timestamp;
        p.bump = ctx.bumps.proposal;
        b.next_proposal += 1;
        if let Some(i) = b.officials.iter().position(|o| *o == proposer) {
            p.approvals |= 1 << i;
        }
        emit!(BookEvent { book: b.key(), kind: 100 + kind, seq: p.seq, entry_hash, amount, root: b.root });
        if p.approvals.count_ones() >= b.threshold as u32 {
            commit(b, p)?;
            p.close(ctx.accounts.payer.to_account_info())?;
        }
        Ok(())
    }

    /// An official approves. At the threshold the entry is chained into the
    /// book and the proposal account closes (rent goes back to `payer`).
    pub fn approve(ctx: Context<Approve>) -> Result<()> {
        let official = ctx.accounts.official.key();
        let b = &mut ctx.accounts.book;
        let p = &mut ctx.accounts.proposal;
        let i = b.officials.iter().position(|o| *o == official).ok_or_else(|| error!(FunguError::NotOfficial))?;
        require!(p.approvals & (1 << i) == 0, FunguError::AlreadyApproved);
        p.approvals |= 1 << i;
        if p.approvals.count_ones() >= b.threshold as u32 {
            commit(b, p)?;
            p.close(ctx.accounts.payer.to_account_info())?;
        }
        Ok(())
    }

    /// The proposer or any official withdraws a proposal that hasn't landed.
    pub fn reject(ctx: Context<Approve>) -> Result<()> {
        let who = ctx.accounts.official.key();
        let b = &ctx.accounts.book;
        let p = &ctx.accounts.proposal;
        require!(who == p.proposer || b.officials.contains(&who), FunguError::NotOfficial);
        emit!(BookEvent { book: b.key(), kind: 200, seq: p.seq, entry_hash: p.entry_hash, amount: p.amount, root: b.root });
        ctx.accounts.proposal.close(ctx.accounts.payer.to_account_info())
    }
}

// ------------------------------------------------------------------ helpers

/// Chain an approved entry into the book:
/// root = sha256(root | kind | amount_le | entry_hash).
fn commit(b: &mut Account<Book>, p: &Account<Proposal>) -> Result<()> {
    b.root = anchor_lang::solana_program::hash::hashv(&[&b.root, &[p.kind], &p.amount.to_le_bytes(), &p.entry_hash]).to_bytes();
    b.entries += 1;
    if p.kind == ENTRY_RULES {
        b.rules_hash = p.entry_hash;
    }
    emit!(BookEvent { book: b.key(), kind: p.kind, seq: b.entries, entry_hash: p.entry_hash, amount: p.amount, root: b.root });
    Ok(())
}

fn apply_repayment(
    a: &mut Account<Agreement>,
    profile: &mut Account<Profile>,
    amount: u64,
    kind: u8,
) -> Result<()> {
    a.repaid += amount;
    emit!(AgreementEvent { agreement: a.key(), kind, amount });
    if a.repaid == a.principal {
        let now = Clock::get()?.unix_timestamp;
        a.status = AgreementStatus::Settled;
        a.closed_at = now;
        profile.settled = profile.settled.saturating_add(1);
        if now <= a.due_ts {
            profile.on_time = profile.on_time.saturating_add(1);
        } else {
            profile.late = profile.late.saturating_add(1);
        }
        emit!(AgreementEvent { agreement: a.key(), kind: 9, amount: a.principal });
    }
    Ok(())
}

fn member_index(c: &Chama, member: &Pubkey) -> Result<usize> {
    c.members
        .iter()
        .position(|m| m == member)
        .ok_or_else(|| error!(FunguError::NotMember))
}

fn pay_into_vault(ctx: &Context<MemberMoney>, amount: u64) -> Result<()> {
    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.member_ata.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.member.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.mint.decimals,
    )
}

fn pay_from_vault<'info>(
    chama: &Account<'info, Chama>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    token_program: &Interface<'info, TokenInterface>,
    amount: u64,
) -> Result<()> {
    let id = chama.id.to_le_bytes();
    let bump = [chama.bump];
    let seeds: &[&[u8]] = &[b"chama", chama.creator.as_ref(), &id, &bump];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: chama.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        mint.decimals,
    )
}

// ----------------------------------------------------------------- accounts

#[account]
#[derive(InitSpace)]
pub struct Profile {
    pub owner: Pubkey,
    pub settled: u32,
    pub on_time: u32,
    pub late: u32,
    pub chama_cycles: u32,
    pub chama_missed: u32,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum AgreementStatus {
    Proposed,
    Active,
    Settled,
    Cancelled,
    Forgiven,
}

#[account]
#[derive(InitSpace)]
pub struct Agreement {
    pub id: u64,
    pub lender: Pubkey,
    pub borrower: Pubkey,
    pub guarantor: Option<Pubkey>,
    pub guarantor_signed: bool,
    pub mint: Pubkey,
    pub principal: u64,
    pub repaid: u64,
    pub due_ts: i64,
    pub terms_hash: [u8; 32],
    pub status: AgreementStatus,
    pub funded: bool,
    pub overdue: bool,
    pub created_at: i64,
    pub closed_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum ChamaStatus {
    Forming,
    Active,
    Completed,
}

#[account]
#[derive(InitSpace)]
pub struct Chama {
    pub id: u64,
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    #[max_len(32)]
    pub name: String,
    pub contribution: u64,
    pub period_secs: i64,
    pub max_members: u8,
    pub bond: u64,
    pub status: ChamaStatus,
    pub round: u8,
    pub round_start: i64,
    pub paid_mask: u16,
    #[max_len(12)]
    pub members: Vec<Pubkey>,
    #[max_len(12)]
    pub bonds: Vec<u64>,
    #[max_len(12)]
    pub defaults: Vec<u8>,
    pub bump: u8,
}

// ------------------------------------------------------------- instructions

#[derive(Accounts)]
#[instruction(name: String)]
pub struct RegisterName<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub user: Signer<'info>,
    #[account(init, payer = payer, space = 8 + NameRecord::INIT_SPACE,
        seeds = [b"name", name.as_bytes()], bump)]
    pub name_record: Account<'info, NameRecord>,
    #[account(init, payer = payer, space = 8 + NameRecord::INIT_SPACE,
        seeds = [b"handle", user.key().as_ref()], bump)]
    pub handle: Account<'info, NameRecord>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct NameRecord {
    pub owner: Pubkey,
    #[max_len(20)]
    pub name: String,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitProfile<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub user: Signer<'info>,
    #[account(init, payer = payer, space = 8 + Profile::INIT_SPACE,
        seeds = [b"profile", user.key().as_ref()], bump)]
    pub profile: Account<'info, Profile>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CreateAgreement<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub lender: Signer<'info>,
    /// CHECK: any wallet can be a borrower; only its address is stored.
    pub borrower: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(init, payer = payer, space = 8 + Agreement::INIT_SPACE,
        seeds = [b"agreement", lender.key().as_ref(), borrower.key().as_ref(), &id.to_le_bytes()], bump)]
    pub agreement: Account<'info, Agreement>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BorrowerAction<'info> {
    pub borrower: Signer<'info>,
    #[account(mut, has_one = borrower)]
    pub agreement: Account<'info, Agreement>,
}

#[derive(Accounts)]
pub struct LenderAction<'info> {
    pub lender: Signer<'info>,
    #[account(mut, has_one = lender)]
    pub agreement: Account<'info, Agreement>,
}

#[derive(Accounts)]
pub struct GuarantorAction<'info> {
    pub guarantor: Signer<'info>,
    #[account(mut)]
    pub agreement: Account<'info, Agreement>,
}

#[derive(Accounts)]
pub struct MarkOverdue<'info> {
    #[account(mut)]
    pub agreement: Account<'info, Agreement>,
}

#[derive(Accounts)]
pub struct FundAgreement<'info> {
    pub lender: Signer<'info>,
    #[account(mut, has_one = lender, has_one = mint)]
    pub agreement: Account<'info, Agreement>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = lender, token::token_program = token_program)]
    pub lender_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::token_program = token_program,
        constraint = borrower_ata.owner == agreement.borrower @ FunguError::WrongOwner)]
    pub borrower_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Repay<'info> {
    pub borrower: Signer<'info>,
    #[account(mut, has_one = borrower, has_one = mint)]
    pub agreement: Account<'info, Agreement>,
    #[account(mut, seeds = [b"profile", borrower.key().as_ref()], bump = borrower_profile.bump)]
    pub borrower_profile: Account<'info, Profile>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = borrower, token::token_program = token_program)]
    pub borrower_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::token_program = token_program,
        constraint = lender_ata.owner == agreement.lender @ FunguError::WrongOwner)]
    pub lender_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ConfirmOffchain<'info> {
    pub lender: Signer<'info>,
    #[account(mut, has_one = lender)]
    pub agreement: Account<'info, Agreement>,
    #[account(mut, seeds = [b"profile", agreement.borrower.as_ref()], bump = borrower_profile.bump)]
    pub borrower_profile: Account<'info, Profile>,
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CreateChama<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub creator: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(init, payer = payer, space = 8 + Chama::INIT_SPACE,
        seeds = [b"chama", creator.key().as_ref(), &id.to_le_bytes()], bump)]
    pub chama: Account<'info, Chama>,
    #[account(init, payer = payer, associated_token::mint = mint,
        associated_token::authority = chama, associated_token::token_program = token_program)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MemberMoney<'info> {
    pub member: Signer<'info>,
    #[account(mut, has_one = mint, has_one = vault)]
    pub chama: Account<'info, Chama>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = member, token::token_program = token_program)]
    pub member_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Payout<'info> {
    #[account(mut, has_one = mint, has_one = vault)]
    pub chama: Account<'info, Chama>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub recipient_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct WithdrawBond<'info> {
    pub member: Signer<'info>,
    #[account(mut, has_one = mint, has_one = vault)]
    pub chama: Account<'info, Chama>,
    #[account(mut, seeds = [b"profile", member.key().as_ref()], bump = profile.bump)]
    pub profile: Account<'info, Profile>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = member, token::token_program = token_program)]
    pub member_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

// ------------------------------------------------------------------- events

/// kind: 0 created, 1 accepted, 2 cancelled, 3 guarantor signed, 4 funded,
/// 5 repaid on-chain, 6 repaid off-chain (lender confirmed), 7 overdue,
/// 8 forgiven, 9 settled
#[event]
pub struct AgreementEvent {
    pub agreement: Pubkey,
    pub kind: u8,
    pub amount: u64,
}

#[event]
pub struct ReceiptEvent {
    pub agreement: Pubkey,
    pub amount: u64,
    pub receipt_hash: [u8; 32],
}

/// kind: 0 created, 1 joined, 2 left, 3 contributed, 4 payout, 5 bond withdrawn
#[event]
pub struct ChamaEvent {
    pub chama: Pubkey,
    pub kind: u8,
    pub member: Pubkey,
    pub amount: u64,
}

pub const MAX_OFFICIALS: usize = 5;
/// Entry kinds: 1 contribution, 2 payout, 3 repayment, 4 loan given, 5 fine,
/// 6 member joined, 7 member left, 8 note, 9 rule change.
pub const ENTRY_RULES: u8 = 9;
pub const ENTRY_KIND_MAX: u8 = 9;

#[account]
#[derive(InitSpace)]
pub struct Book {
    pub id: u64,
    pub creator: Pubkey,
    #[max_len(5)]
    pub officials: Vec<Pubkey>,
    pub threshold: u8,
    pub rules_hash: [u8; 32],
    pub currency: [u8; 3],
    pub root: [u8; 32],
    pub entries: u64,
    pub next_proposal: u64,
    pub created_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Proposal {
    pub book: Pubkey,
    pub seq: u64,
    pub proposer: Pubkey,
    pub kind: u8,
    pub entry_hash: [u8; 32],
    pub amount: u64,
    pub approvals: u8,
    pub created_at: i64,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CreateBook<'info> {
    #[account(init, payer = payer, space = 8 + Book::INIT_SPACE, seeds = [b"book", creator.key().as_ref(), &id.to_le_bytes()], bump)]
    pub book: Account<'info, Book>,
    pub creator: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Propose<'info> {
    #[account(mut)]
    pub book: Account<'info, Book>,
    #[account(init, payer = payer, space = 8 + Proposal::INIT_SPACE, seeds = [b"proposal", book.key().as_ref(), &book.next_proposal.to_le_bytes()], bump)]
    pub proposal: Account<'info, Proposal>,
    pub proposer: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Approve<'info> {
    #[account(mut)]
    pub book: Account<'info, Book>,
    #[account(mut, has_one = book)]
    pub proposal: Account<'info, Proposal>,
    pub official: Signer<'info>,
    /// CHECK: only receives the closed proposal's rent.
    #[account(mut)]
    pub payer: UncheckedAccount<'info>,
}

#[event]
pub struct BookEvent {
    pub book: Pubkey,
    pub kind: u8,
    pub seq: u64,
    pub entry_hash: [u8; 32],
    pub amount: u64,
    pub root: [u8; 32],
}

#[error_code]
pub enum FunguError {
    #[msg("Amount must be more than zero")]
    ZeroAmount,
    #[msg("The due date must be in the future")]
    DueInPast,
    #[msg("Lender and borrower must be different people")]
    SelfAgreement,
    #[msg("The guarantor must be someone other than the lender or borrower")]
    SelfGuarantee,
    #[msg("Not allowed in the current status")]
    WrongStatus,
    #[msg("The terms you signed don't match this agreement")]
    TermsMismatch,
    #[msg("Only the named guarantor can sign")]
    NotGuarantor,
    #[msg("Already funded")]
    AlreadyFunded,
    #[msg("That's more than what is left to repay")]
    Overpayment,
    #[msg("Not due yet")]
    NotYetDue,
    #[msg("Token account belongs to someone else")]
    WrongOwner,
    #[msg("Chama name is too long (32 characters max)")]
    NameTooLong,
    #[msg("A round must be at least 60 seconds")]
    PeriodTooShort,
    #[msg("A chama needs 2 to 12 members")]
    BadMemberCount,
    #[msg("Already a member")]
    AlreadyMember,
    #[msg("The chama is full")]
    ChamaFull,
    #[msg("Not a member of this chama")]
    NotMember,
    #[msg("Already paid this round")]
    AlreadyPaid,
    #[msg("The round isn't over and not everyone has paid")]
    RoundNotOver,
    #[msg("Bond already withdrawn")]
    AlreadyWithdrawn,
    #[msg("Names are 3-20 lower-case letters, digits or _, starting with a letter")]
    InvalidName,
    #[msg("A book needs 1 to 5 distinct officials, including its creator")]
    BadOfficials,
    #[msg("Approvals needed must be between 1 and the number of officials")]
    BadThreshold,
    #[msg("Only an official of this book can do that")]
    NotOfficial,
    #[msg("Already approved")]
    AlreadyApproved,
    #[msg("Unknown entry type")]
    BadKind,
}
