use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::{
    ADMIN_PUBKEY, USDC_MINT, VAULT_AUTHORITY_SEED, WBTC_MINT, WETH_MINT, WHIRLPOOL_PROGRAM_ID,
    WSOL_MINT,
};
use crate::state::{ErrorCode, Vault};
use crate::utils::{anchor_orca_swap, validate_ata_exists};

#[allow(clippy::too_many_arguments)]
pub fn handle_swap_usdc_to_assets(
    ctx: Context<SwapUsdcToAssets>,
    usdc_amount_in: u64,
    usdc_min_wsol_out: u64,
    usdc_a_to_b: bool,
    wbtc_amount_in: u64,
    wbtc_min_out: u64,
    wbtc_a_to_b: bool,
    weth_amount_in: u64,
    weth_min_out: u64,
    weth_a_to_b: bool,
) -> Result<()> {
    require!(usdc_amount_in > 0, ErrorCode::InvalidSwapAmounts);

    let authority_bump = ctx.accounts.vault.authority_bump;

    // Step 0: Validate that all required vault ATAs have been pre-created off-chain.
    // This avoids the compute cost of ATA creation inside the instruction.
    // All four (USDC, wSOL, WBTC, WETH) must exist and be correctly configured
    // (owned by vault_authority, correct mint).
    validate_ata_exists(
        ctx.accounts.vault_usdc_ata.to_account_info(),
        ctx.accounts.vault_authority.to_account_info(),
        ctx.accounts.usdc_mint.to_account_info(),
    )?;
    validate_ata_exists(
        ctx.accounts.vault_wsol_ata.to_account_info(),
        ctx.accounts.vault_authority.to_account_info(),
        ctx.accounts.wsol_mint.to_account_info(),
    )?;
    validate_ata_exists(
        ctx.accounts.vault_wbtc_ata.to_account_info(),
        ctx.accounts.vault_authority.to_account_info(),
        ctx.accounts.wbtc_mint.to_account_info(),
    )?;
    validate_ata_exists(
        ctx.accounts.vault_weth_ata.to_account_info(),
        ctx.accounts.vault_authority.to_account_info(),
        ctx.accounts.weth_mint.to_account_info(),
    )?;

    // Step 1: Transfer USDC from signer's ATA to vault's USDC ATA
    anchor_spl::token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token::Transfer {
                from: ctx.accounts.signer_usdc_ata.to_account_info(),
                to: ctx.accounts.vault_usdc_ata.to_account_info(),
                authority: ctx.accounts.signer.to_account_info(),
            },
        ),
        usdc_amount_in,
    )
    .map_err(|_| error!(ErrorCode::CpiFailure))?;

    // Step 2: Swap USDC → wSOL
    let usdc_before = read_vault_ata_balance(&ctx.accounts.vault_usdc_ata)?;
    let wsol_before = read_vault_ata_balance(&ctx.accounts.vault_wsol_ata)?;

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
        usdc_amount_in,
        usdc_min_wsol_out,
        usdc_a_to_b,
    )?;

    let usdc_after = read_vault_ata_balance(&ctx.accounts.vault_usdc_ata)?;
    let wsol_after = read_vault_ata_balance(&ctx.accounts.vault_wsol_ata)?;
    msg!(
        "swap1 USDC->wSOL: input_usdc={} output_wsol={}",
        usdc_before.saturating_sub(usdc_after),
        wsol_after.saturating_sub(wsol_before)
    );

    // Step 3: Read wSOL balance after the first swap; verify it covers both legs.
    // We only read wSOL produced by this swap — any pre-existing balance is ignored
    // by requiring wbtc_in + weth_in <= fresh balance (conservative).
    let wsol_balance = {
        let wsol_data = ctx.accounts.vault_wsol_ata.try_borrow_data()?;
        TokenAccount::try_deserialize(&mut wsol_data.as_ref())?.amount
    };

    require!(
        wbtc_amount_in
            .checked_add(weth_amount_in)
            .ok_or(ErrorCode::InvalidSwapAmounts)?
            <= wsol_balance,
        ErrorCode::InsufficientWsolBalance
    );

    // Step 4: Swap wSOL → WBTC
    let wsol_before_btc = read_vault_ata_balance(&ctx.accounts.vault_wsol_ata)?;
    let wbtc_before = read_vault_ata_balance(&ctx.accounts.vault_wbtc_ata)?;

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

    let wsol_after_btc = read_vault_ata_balance(&ctx.accounts.vault_wsol_ata)?;
    let wbtc_after = read_vault_ata_balance(&ctx.accounts.vault_wbtc_ata)?;
    msg!(
        "swap2 wSOL->WBTC: input_wsol={} output_wbtc={}",
        wsol_before_btc.saturating_sub(wsol_after_btc),
        wbtc_after.saturating_sub(wbtc_before)
    );

    // Step 5: Swap wSOL → WETH
    let wsol_before_eth = read_vault_ata_balance(&ctx.accounts.vault_wsol_ata)?;
    let weth_before = read_vault_ata_balance(&ctx.accounts.vault_weth_ata)?;

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

    let wsol_after_eth = read_vault_ata_balance(&ctx.accounts.vault_wsol_ata)?;
    let weth_after = read_vault_ata_balance(&ctx.accounts.vault_weth_ata)?;
    msg!(
        "swap3 wSOL->WETH: input_wsol={} output_weth={}",
        wsol_before_eth.saturating_sub(wsol_after_eth),
        weth_after.saturating_sub(weth_before)
    );

    // Step 6: Update vault bookkeeping — deserialize all four ATAs from raw bytes
    // (all are UncheckedAccount so we read data directly after the swaps settle).
    let btc_amount = {
        let data = ctx.accounts.vault_wbtc_ata.try_borrow_data()?;
        TokenAccount::try_deserialize(&mut data.as_ref())?.amount
    };
    let eth_amount = {
        let data = ctx.accounts.vault_weth_ata.try_borrow_data()?;
        TokenAccount::try_deserialize(&mut data.as_ref())?.amount
    };
    let sol_amount = {
        let data = ctx.accounts.vault_wsol_ata.try_borrow_data()?;
        TokenAccount::try_deserialize(&mut data.as_ref())?.amount
    };
    let usdc_amount = {
        let data = ctx.accounts.vault_usdc_ata.try_borrow_data()?;
        TokenAccount::try_deserialize(&mut data.as_ref())?.amount
    };

    let vault = &mut ctx.accounts.vault;
    vault.btc_amount = btc_amount;
    vault.eth_amount = eth_amount;
    vault.sol_amount = sol_amount;
    vault.usdc_amount = usdc_amount;

    msg!(
        "swap_usdc_to_assets done: usdc={} wsol={} wbtc={} weth={}",
        vault.usdc_amount,
        vault.sol_amount,
        vault.btc_amount,
        vault.eth_amount
    );

    Ok(())
}

/// Helper to safely read the token balance from a vault ATA (UncheckedAccount).
/// Returns 0 if the account is empty (should not happen after validation).
fn read_vault_ata_balance(ata: &UncheckedAccount) -> Result<u64> {
    if ata.data_is_empty() {
        return Ok(0);
    }
    let data = ata.try_borrow_data()?;
    Ok(TokenAccount::try_deserialize(&mut data.as_ref())?.amount)
}

#[derive(Accounts)]
pub struct SwapUsdcToAssets<'info> {
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

    /// Signer USDC ATA — source of USDC.
    #[account(mut)]
    pub signer_usdc_ata: Account<'info, TokenAccount>,

    /// CHECK: Vault authority USDC ATA — must be pre-created off-chain before calling.
    #[account(mut)]
    pub vault_usdc_ata: UncheckedAccount<'info>,

    #[account(address = USDC_MINT @ ErrorCode::InvalidMint)]
    pub usdc_mint: Account<'info, Mint>,

    /// CHECK: Vault authority wSOL ATA — must be pre-created off-chain before calling.
    #[account(mut)]
    pub vault_wsol_ata: UncheckedAccount<'info>,

    #[account(address = WSOL_MINT @ ErrorCode::InvalidMint)]
    pub wsol_mint: Account<'info, Mint>,

    /// CHECK: Vault authority WBTC ATA — must be pre-created off-chain before calling.
    #[account(mut)]
    pub vault_wbtc_ata: UncheckedAccount<'info>,

    #[account(address = WBTC_MINT @ ErrorCode::InvalidMint)]
    pub wbtc_mint: Account<'info, Mint>,

    /// CHECK: Vault authority WETH ATA — must be pre-created off-chain before calling.
    #[account(mut)]
    pub vault_weth_ata: UncheckedAccount<'info>,

    #[account(address = WETH_MINT @ ErrorCode::InvalidMint)]
    pub weth_mint: Account<'info, Mint>,

    /// CHECK: Orca Whirlpool program.
    #[account(address = WHIRLPOOL_PROGRAM_ID)]
    pub whirlpool_program: UncheckedAccount<'info>,

    // ── USDC/SOL pool accounts ──────────────────────────────────────────────
    /// CHECK: USDC/SOL whirlpool state account.
    #[account(mut)]
    pub usdc_whirlpool: UncheckedAccount<'info>,
    /// CHECK: Token owner account A for USDC/SOL pool.
    #[account(mut)]
    pub usdc_token_owner_a: UncheckedAccount<'info>,
    /// CHECK: Token vault A for USDC/SOL pool.
    #[account(mut)]
    pub usdc_vault_a: UncheckedAccount<'info>,
    /// CHECK: Token owner account B for USDC/SOL pool.
    #[account(mut)]
    pub usdc_token_owner_b: UncheckedAccount<'info>,
    /// CHECK: Token vault B for USDC/SOL pool.
    #[account(mut)]
    pub usdc_vault_b: UncheckedAccount<'info>,
    /// CHECK: Tick array 0 for USDC/SOL pool.
    #[account(mut)]
    pub usdc_tick_array_0: UncheckedAccount<'info>,
    /// CHECK: Tick array 1 for USDC/SOL pool.
    #[account(mut)]
    pub usdc_tick_array_1: UncheckedAccount<'info>,
    /// CHECK: Tick array 2 for USDC/SOL pool.
    #[account(mut)]
    pub usdc_tick_array_2: UncheckedAccount<'info>,
    /// CHECK: Oracle PDA for USDC/SOL pool.
    pub usdc_oracle: UncheckedAccount<'info>,

    // ── WBTC pool accounts ──────────────────────────────────────────────────
    /// CHECK: WSOL/WBTC whirlpool state account.
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
    /// CHECK: WSOL/WETH whirlpool state account.
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
