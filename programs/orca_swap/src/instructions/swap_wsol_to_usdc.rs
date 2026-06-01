use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::{ADMIN_PUBKEY, VAULT_AUTHORITY_SEED, WHIRLPOOL_PROGRAM_ID};
use crate::state::{ErrorCode, Vault};
use crate::utils::{anchor_orca_swap, create_ata_idempotent};

#[derive(Accounts)]
pub struct SwapWsolToUsdc<'info> {
    #[account(
        mut,
        address = ADMIN_PUBKEY @ ErrorCode::UnauthorizedAdmin,
    )]
    pub signer: Signer<'info>,

    #[account(mut)]
    pub vault: Account<'info, Vault>,

    /// CHECK: PDA authority for token accounts and Orca swap CPIs.
    #[account(
        seeds = [VAULT_AUTHORITY_SEED],
        bump = vault.authority_bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,

    pub associated_token_program: Program<'info, AssociatedToken>,

    pub system_program: Program<'info, System>,

    /// CHECK: Vault authority WSOL ATA — source of swap input.
    #[account(mut)]
    pub vault_wsol_ata: UncheckedAccount<'info>,

    pub wsol_mint: Account<'info, Mint>,

    /// CHECK: Vault authority USDC ATA — created idempotently if missing.
    #[account(mut)]
    pub vault_usdc_ata: UncheckedAccount<'info>,

    pub usdc_mint: Account<'info, Mint>,

    /// CHECK: Orca Whirlpool program.
    #[account(address = WHIRLPOOL_PROGRAM_ID)]
    pub whirlpool_program: UncheckedAccount<'info>,

    /// CHECK: SOL/USDC whirlpool state account.
    #[account(mut)]
    pub usdc_whirlpool: UncheckedAccount<'info>,
    /// CHECK: Token owner account A for SOL/USDC pool.
    #[account(mut)]
    pub usdc_token_owner_a: UncheckedAccount<'info>,
    /// CHECK: Token vault A for SOL/USDC pool.
    #[account(mut)]
    pub usdc_vault_a: UncheckedAccount<'info>,
    /// CHECK: Token owner account B for SOL/USDC pool.
    #[account(mut)]
    pub usdc_token_owner_b: UncheckedAccount<'info>,
    /// CHECK: Token vault B for SOL/USDC pool.
    #[account(mut)]
    pub usdc_vault_b: UncheckedAccount<'info>,
    /// CHECK: Tick array 0 for SOL/USDC pool.
    #[account(mut)]
    pub usdc_tick_array_0: UncheckedAccount<'info>,
    /// CHECK: Tick array 1 for SOL/USDC pool.
    #[account(mut)]
    pub usdc_tick_array_1: UncheckedAccount<'info>,
    /// CHECK: Tick array 2 for SOL/USDC pool.
    #[account(mut)]
    pub usdc_tick_array_2: UncheckedAccount<'info>,
    /// CHECK: Oracle PDA for SOL/USDC pool.
    pub usdc_oracle: UncheckedAccount<'info>,
}

pub fn handle_swap_wsol_to_usdc(
    ctx: Context<SwapWsolToUsdc>,
    wsol_amount_in: u64,
    min_usdc_out: u64,
    a_to_b: bool,
) -> Result<()> {
    require!(wsol_amount_in > 0, ErrorCode::InvalidSwapAmounts);

    let wsol_data = ctx.accounts.vault_wsol_ata.try_borrow_data()?;
    let wsol_account = TokenAccount::try_deserialize(&mut wsol_data.as_ref())?;
    require_keys_eq!(
        wsol_account.owner,
        ctx.accounts.vault_authority.key(),
        ErrorCode::IncorrectOwner
    );
    require_keys_eq!(
        wsol_account.mint,
        ctx.accounts.wsol_mint.key(),
        ErrorCode::InvalidMint
    );
    require!(
        wsol_amount_in <= wsol_account.amount,
        ErrorCode::InsufficientWsolBalance
    );

    let authority_bump = ctx.accounts.vault.authority_bump;

    create_ata_idempotent(
        ctx.accounts.signer.to_account_info(),
        ctx.accounts.vault_usdc_ata.to_account_info(),
        ctx.accounts.vault_authority.to_account_info(),
        ctx.accounts.usdc_mint.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.associated_token_program.to_account_info(),
    )?;

    anchor_orca_swap(
        ctx.accounts.whirlpool_program.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.vault_authority.to_account_info(),
        ctx.accounts.usdc_whirlpool.to_account_info(),
        ctx.accounts.usdc_token_owner_a.to_account_info(),
        ctx.accounts.usdc_vault_a.to_account_info(),
        ctx.accounts.usdc_token_owner_b.to_account_info(),
        ctx.accounts.usdc_vault_b.to_account_info(),
        ctx.accounts.usdc_tick_array_0.to_account_info(),
        ctx.accounts.usdc_tick_array_1.to_account_info(),
        ctx.accounts.usdc_tick_array_2.to_account_info(),
        ctx.accounts.usdc_oracle.to_account_info(),
        authority_bump,
        wsol_amount_in,
        min_usdc_out,
        a_to_b,
    )?;

    let wsol_data = ctx.accounts.vault_wsol_ata.try_borrow_data()?;
    let wsol_account = TokenAccount::try_deserialize(&mut wsol_data.as_ref())?;
    let usdc_data = ctx.accounts.vault_usdc_ata.try_borrow_data()?;
    let usdc_account = TokenAccount::try_deserialize(&mut usdc_data.as_ref())?;

    let vault = &mut ctx.accounts.vault;
    vault.sol_amount = wsol_account.amount;
    vault.usdc_amount = usdc_account.amount;

    msg!(
        "swap_wsol_to_usdc done: wsol={} usdc={}",
        vault.sol_amount,
        vault.usdc_amount,
    );

    Ok(())
}
