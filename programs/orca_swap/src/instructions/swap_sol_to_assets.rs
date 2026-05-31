use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::{ADMIN_PUBKEY, VAULT_AUTHORITY_SEED, WHIRLPOOL_PROGRAM_ID};
use crate::state::{ErrorCode, Vault};
use crate::utils::anchor_orca_swap;

#[derive(Accounts)]
pub struct SwapSolToAssets<'info> {
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

    pub system_program: Program<'info, System>,

    pub token_program: Program<'info, Token>,

    /// CHECK: Vault authority WSOL ATA — receives wrapped SOL.
    /// Checked in body and created/initialized idempotently if empty.
    #[account(mut)]
    pub vault_wsol_ata: UncheckedAccount<'info>,

    pub wsol_mint: Account<'info, Mint>,

    pub associated_token_program: Program<'info, AssociatedToken>,

    /// Vault authority WBTC ATA — receives WBTC from first swap.
    #[account(mut)]
    pub vault_wbtc_ata: Account<'info, TokenAccount>,

    /// Vault authority WETH ATA — receives WETH from second swap.
    #[account(mut)]
    pub vault_weth_ata: Account<'info, TokenAccount>,

    /// CHECK: Orca Whirlpool program.
    #[account(address = WHIRLPOOL_PROGRAM_ID)]
    pub whirlpool_program: UncheckedAccount<'info>,

    // ── WBTC pool accounts ──────────────────────────────────────────────────
    /// CHECK: WBTC whirlpool state account.
    #[account(mut)]
    pub wbtc_whirlpool: UncheckedAccount<'info>,
    /// CHECK: Token owner account A for WBTC pool.
    #[account(mut)]
    pub wbtc_token_owner_a: UncheckedAccount<'info>,
    /// CHECK: Token vault A for WBTC pool.
    #[account(mut)]
    pub wbtc_vault_a: UncheckedAccount<'info>,
    /// CHECK: Token owner account B for WBTC pool.
    #[account(mut)]
    pub wbtc_token_owner_b: UncheckedAccount<'info>,
    /// CHECK: Token vault B for WBTC pool.
    #[account(mut)]
    pub wbtc_vault_b: UncheckedAccount<'info>,
    /// CHECK: Tick array 0 for WBTC pool.
    #[account(mut)]
    pub wbtc_tick_array_0: UncheckedAccount<'info>,
    /// CHECK: Tick array 1 for WBTC pool.
    #[account(mut)]
    pub wbtc_tick_array_1: UncheckedAccount<'info>,
    /// CHECK: Tick array 2 for WBTC pool.
    #[account(mut)]
    pub wbtc_tick_array_2: UncheckedAccount<'info>,
    /// CHECK: Oracle PDA for WBTC pool.
    pub wbtc_oracle: UncheckedAccount<'info>,

    // ── WETH pool accounts ──────────────────────────────────────────────────
    /// CHECK: WETH whirlpool state account.
    #[account(mut)]
    pub weth_whirlpool: UncheckedAccount<'info>,
    /// CHECK: Token owner account A for WETH pool.
    #[account(mut)]
    pub weth_token_owner_a: UncheckedAccount<'info>,
    /// CHECK: Token vault A for WETH pool.
    #[account(mut)]
    pub weth_vault_a: UncheckedAccount<'info>,
    /// CHECK: Token owner account B for WETH pool.
    #[account(mut)]
    pub weth_token_owner_b: UncheckedAccount<'info>,
    /// CHECK: Token vault B for WETH pool.
    #[account(mut)]
    pub weth_vault_b: UncheckedAccount<'info>,
    /// CHECK: Tick array 0 for WETH pool.
    #[account(mut)]
    pub weth_tick_array_0: UncheckedAccount<'info>,
    /// CHECK: Tick array 1 for WETH pool.
    #[account(mut)]
    pub weth_tick_array_1: UncheckedAccount<'info>,
    /// CHECK: Tick array 2 for WETH pool.
    #[account(mut)]
    pub weth_tick_array_2: UncheckedAccount<'info>,
    /// CHECK: Oracle PDA for WETH pool.
    pub weth_oracle: UncheckedAccount<'info>,
}

/// Create the vault's wSOL ATA idempotently via the AssociatedToken program.
/// If the account already exists, verify its owner and mint match expectations.
fn create_wsol_ata_idempotent<'info>(
    payer: AccountInfo<'info>,
    vault_wsol_ata: AccountInfo<'info>,
    vault_authority: AccountInfo<'info>,
    wsol_mint: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    associated_token_program: AccountInfo<'info>,
) -> Result<()> {
    if vault_wsol_ata.data_is_empty() {
        msg!("Creating vault wSOL ATA idempotently");
        let cpi_accounts = anchor_spl::associated_token::Create {
            payer,
            associated_token: vault_wsol_ata,
            authority: vault_authority,
            mint: wsol_mint,
            system_program,
            token_program,
        };
        let cpi_ctx = CpiContext::new(associated_token_program, cpi_accounts);
        anchor_spl::associated_token::create(cpi_ctx)
            .map_err(|_| error!(ErrorCode::CpiFailure))?;
    } else {
        let data = vault_wsol_ata.try_borrow_data()?;
        let wsol_account = TokenAccount::try_deserialize(&mut data.as_ref())?;
        require_keys_eq!(
            wsol_account.owner,
            vault_authority.key(),
            ErrorCode::IncorrectOwner
        );
        require_keys_eq!(
            wsol_account.mint,
            wsol_mint.key(),
            ErrorCode::InvalidMint
        );
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn handle_swap_sol_to_assets(
    ctx: Context<SwapSolToAssets>,
    sol_amount: u64,
    wbtc_amount_in: u64,
    wbtc_min_out: u64,
    wbtc_a_to_b: bool,
    weth_amount_in: u64,
    weth_min_out: u64,
    weth_a_to_b: bool,
) -> Result<()> {
    require!(
        wbtc_amount_in
            .checked_add(weth_amount_in)
            .ok_or(ErrorCode::InvalidSwapAmounts)?
            <= sol_amount,
        ErrorCode::InvalidSwapAmounts
    );

    let authority_bump = ctx.accounts.vault.authority_bump;

    // Step 0: Create wSOL ATA idempotently if it does not exist
    create_wsol_ata_idempotent(
        ctx.accounts.signer.to_account_info(),
        ctx.accounts.vault_wsol_ata.to_account_info(),
        ctx.accounts.vault_authority.to_account_info(),
        ctx.accounts.wsol_mint.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.associated_token_program.to_account_info(),
    )?;

    // Step 1: SOL → WSOL ATA (System transfer)
    anchor_lang::system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.signer.to_account_info(),
                to: ctx.accounts.vault_wsol_ata.to_account_info(),
            },
        ),
        sol_amount,
    )
    .map_err(|_| error!(ErrorCode::CpiFailure))?;

    // Step 2: SyncNative on WSOL ATA
    anchor_spl::token::sync_native(CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        anchor_spl::token::SyncNative {
            account: ctx.accounts.vault_wsol_ata.to_account_info(),
        },
    ))
    .map_err(|_| error!(ErrorCode::CpiFailure))?;

    // Step 3: WSOL → WBTC (Orca swap CPI #1)
    anchor_orca_swap(
        ctx.accounts.whirlpool_program.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.vault_authority.to_account_info(),
        ctx.accounts.wbtc_whirlpool.to_account_info(),
        ctx.accounts.wbtc_token_owner_a.to_account_info(),
        ctx.accounts.wbtc_vault_a.to_account_info(),
        ctx.accounts.wbtc_token_owner_b.to_account_info(),
        ctx.accounts.wbtc_vault_b.to_account_info(),
        ctx.accounts.wbtc_tick_array_0.to_account_info(),
        ctx.accounts.wbtc_tick_array_1.to_account_info(),
        ctx.accounts.wbtc_tick_array_2.to_account_info(),
        ctx.accounts.wbtc_oracle.to_account_info(),
        authority_bump,
        wbtc_amount_in,
        wbtc_min_out,
        wbtc_a_to_b,
    )?;

    // Step 4: WSOL → WETH (Orca swap CPI #2)
    anchor_orca_swap(
        ctx.accounts.whirlpool_program.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.vault_authority.to_account_info(),
        ctx.accounts.weth_whirlpool.to_account_info(),
        ctx.accounts.weth_token_owner_a.to_account_info(),
        ctx.accounts.weth_vault_a.to_account_info(),
        ctx.accounts.weth_token_owner_b.to_account_info(),
        ctx.accounts.weth_vault_b.to_account_info(),
        ctx.accounts.weth_tick_array_0.to_account_info(),
        ctx.accounts.weth_tick_array_1.to_account_info(),
        ctx.accounts.weth_tick_array_2.to_account_info(),
        ctx.accounts.weth_oracle.to_account_info(),
        authority_bump,
        weth_amount_in,
        weth_min_out,
        weth_a_to_b,
    )?;


    // Update vault bookkeeping from ATA balances (reload after CPIs).
    ctx.accounts.vault_wbtc_ata.reload()?;
    ctx.accounts.vault_weth_ata.reload()?;
    
    // For UncheckedAccount, we borrow the data and deserialize manually
    let wsol_data = ctx.accounts.vault_wsol_ata.try_borrow_data()?;
    let wsol_account = TokenAccount::try_deserialize(&mut wsol_data.as_ref())?;

    let vault = &mut ctx.accounts.vault;
    vault.btc_amount = ctx.accounts.vault_wbtc_ata.amount;
    vault.eth_amount = ctx.accounts.vault_weth_ata.amount;
    vault.sol_amount = wsol_account.amount;

    msg!(
        "swap_sol_to_assets done: wsol={} wbtc={} weth={}",
        vault.sol_amount,
        vault.btc_amount,
        vault.eth_amount,
    );

    Ok(())
}
