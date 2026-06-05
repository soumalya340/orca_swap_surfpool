use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::{ADMIN_PUBKEY, VAULT_AUTHORITY_SEED, WHIRLPOOL_PROGRAM_ID};
use crate::state::{ErrorCode, Vault};
use crate::utils::{anchor_orca_swap, create_ata_idempotent};

pub fn handle_swap_wsol_to_usdc(
    ctx: Context<SwapWsolToUsdc>,
    sol_amount_in: u64,
    min_usdc_out: u64,
    a_to_b: bool,
) -> Result<()> {
    require!(sol_amount_in > 0, ErrorCode::InvalidSwapAmounts);

    let authority_bump = ctx.accounts.vault.authority_bump;

    // Step 0: Create the vault's wSOL ATA idempotently if it does not exist.
    // This also validates owner/mint if it already exists.
    create_ata_idempotent(
        ctx.accounts.signer.to_account_info(),
        ctx.accounts.vault_wsol_ata.to_account_info(),
        ctx.accounts.vault_authority.to_account_info(),
        ctx.accounts.wsol_mint.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.associated_token_program.to_account_info(),
    )?;

    // Step 1: Transfer native SOL from the admin signer into the vault's wSOL ATA.
    // The wSOL will be owned by the vault_authority PDA.
    anchor_lang::system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.signer.to_account_info(),
                to: ctx.accounts.vault_wsol_ata.to_account_info(),
            },
        ),
        sol_amount_in,
    )
    .map_err(|_| error!(ErrorCode::CpiFailure))?;

    // Step 2: SyncNative so the lamports become wSOL token balance in the ATA.
    anchor_spl::token::sync_native(CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        anchor_spl::token::SyncNative {
            account: ctx.accounts.vault_wsol_ata.to_account_info(),
        },
    ))
    .map_err(|_| error!(ErrorCode::CpiFailure))?;

    // Step 3: Create the vault's USDC ATA idempotently if it does not exist.
    create_ata_idempotent(
        ctx.accounts.signer.to_account_info(),
        ctx.accounts.vault_usdc_ata.to_account_info(),
        ctx.accounts.vault_authority.to_account_info(),
        ctx.accounts.usdc_mint.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.associated_token_program.to_account_info(),
    )?;

    // Step 4: Perform the Orca Whirlpool swap: wSOL → USDC.
    // The swap is signed by the vault_authority PDA; input is debited from vault_wsol_ata.
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
        sol_amount_in,
        min_usdc_out,
        a_to_b,
    )?;

    // Update only the USDC side in the vault bookkeeping.
    //
    // Why no wsol update?
    // In this function we take native SOL from the admin, wrap it into the
    // vault_wsol_ata, then immediately swap *exactly* that amount of wSOL to USDC.
    // Net effect on the wSOL ATA balance: +wrapped - swapped = 0.
    // Therefore there is no persistent wSOL created or consumed that needs to be
    // reflected in vault.sol_amount. (Any pre-existing wSOL balance in the ATA
    // is untouched in net terms.)
    //
    // We only need to refresh usdc_amount because we produced new USDC for the vault.
    let usdc_data = ctx.accounts.vault_usdc_ata.try_borrow_data()?;
    let usdc_account = TokenAccount::try_deserialize(&mut usdc_data.as_ref())?;

    let vault = &mut ctx.accounts.vault;
    vault.usdc_amount = usdc_account.amount;

    msg!("swap_wsol_to_usdc done: usdc={}", vault.usdc_amount,);

    Ok(())
}

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

    /// CHECK: Vault authority WSOL ATA — receives native SOL from the admin signer,
    /// which is then wrapped (via transfer + sync_native) and used as swap input.
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
