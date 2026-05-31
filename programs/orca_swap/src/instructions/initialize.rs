use anchor_lang::prelude::*;

use crate::constants::{ADMIN_PUBKEY, ANCHOR_DISCRIMINATOR, VAULT_AUTHORITY_SEED, VAULT_SEED};
use crate::state::{ErrorCode, Vault};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        mut,
        address = ADMIN_PUBKEY @ ErrorCode::UnauthorizedAdmin,
    )]
    pub signer: Signer<'info>,

    #[account(
        init_if_needed,
        payer = signer,
        space = ANCHOR_DISCRIMINATOR + Vault::INIT_SPACE,
        seeds = [VAULT_SEED, signer.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,

    /// CHECK: PDA authority for vault token accounts and swap CPIs.
    #[account(
        seeds = [VAULT_AUTHORITY_SEED],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(ctx: Context<Initialize>) -> Result<()> {
    ctx.accounts.vault.authority_bump = ctx.bumps.vault_authority;
    msg!("Vault initialized, authority bump: {}", ctx.bumps.vault_authority);
    Ok(())
}
