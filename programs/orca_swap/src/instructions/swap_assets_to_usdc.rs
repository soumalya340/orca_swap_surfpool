use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::{
    ADMIN_PUBKEY, USDC_MINT, VAULT_AUTHORITY_SEED, WBTC_MINT, WETH_MINT, WHIRLPOOL_PROGRAM_ID,
    WSOL_MINT,
};
use crate::state::{ErrorCode, Vault};
use crate::utils::{anchor_orca_swap, validate_ata_exists};

#[allow(clippy::too_many_arguments)]
pub fn handle_swap_assets_to_usdc(
    ctx: Context<SwapAssetsToUsdc>,
    wbtc_amount_in: u64,
    wbtc_min_wsol_out: u64,
    wbtc_a_to_b: bool,
    weth_amount_in: u64,
    weth_min_wsol_out: u64,
    weth_a_to_b: bool,
    wsol_min_usdc_out: u64,
    usdc_a_to_b: bool,
) -> Result<()> {
    require!(
        wbtc_amount_in > 0 || weth_amount_in > 0,
        ErrorCode::InvalidSwapAmounts
    );

    let authority_bump = ctx.accounts.vault.authority_bump;

    // Step 0: Validate all vault ATAs are pre-created off-chain.
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
    validate_ata_exists(
        ctx.accounts.vault_wsol_ata.to_account_info(),
        ctx.accounts.vault_authority.to_account_info(),
        ctx.accounts.wsol_mint.to_account_info(),
    )?;
    validate_ata_exists(
        ctx.accounts.vault_usdc_ata.to_account_info(),
        ctx.accounts.vault_authority.to_account_info(),
        ctx.accounts.usdc_mint.to_account_info(),
    )?;

    // Step 1: Swap WBTC → wSOL (skip if amount is 0)
    if wbtc_amount_in > 0 {
        let wbtc_before = read_balance(&ctx.accounts.vault_wbtc_ata)?;
        let wsol_before = read_balance(&ctx.accounts.vault_wsol_ata)?;

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
            wbtc_min_wsol_out,
            wbtc_a_to_b,
        )?;

        let wbtc_after = read_balance(&ctx.accounts.vault_wbtc_ata)?;
        let wsol_after = read_balance(&ctx.accounts.vault_wsol_ata)?;
        msg!(
            "swap1 WBTC->wSOL: input_wbtc={} output_wsol={}",
            wbtc_before.saturating_sub(wbtc_after),
            wsol_after.saturating_sub(wsol_before)
        );
    }

    // Step 2: Swap WETH → wSOL (skip if amount is 0)
    if weth_amount_in > 0 {
        let weth_before = read_balance(&ctx.accounts.vault_weth_ata)?;
        let wsol_before = read_balance(&ctx.accounts.vault_wsol_ata)?;

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
            weth_min_wsol_out,
            weth_a_to_b,
        )?;

        let weth_after = read_balance(&ctx.accounts.vault_weth_ata)?;
        let wsol_after = read_balance(&ctx.accounts.vault_wsol_ata)?;
        msg!(
            "swap2 WETH->wSOL: input_weth={} output_wsol={}",
            weth_before.saturating_sub(weth_after),
            wsol_after.saturating_sub(wsol_before)
        );
    }

    // Step 3: Swap accumulated wSOL → USDC.
    // Use the full current wSOL balance so both swap outputs are converted.
    let wsol_total = read_balance(&ctx.accounts.vault_wsol_ata)?;
    require!(wsol_total > 0, ErrorCode::InsufficientWsolBalance);

    let usdc_before = read_balance(&ctx.accounts.vault_usdc_ata)?;

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
        wsol_total,
        wsol_min_usdc_out,
        usdc_a_to_b,
    )?;

    let usdc_after = read_balance(&ctx.accounts.vault_usdc_ata)?;
    msg!(
        "swap3 wSOL->USDC: input_wsol={} output_usdc={}",
        wsol_total,
        usdc_after.saturating_sub(usdc_before)
    );

    // Step 4: Update vault bookkeeping.
    let vault = &mut ctx.accounts.vault;
    vault.btc_amount = read_balance(&ctx.accounts.vault_wbtc_ata)?;
    vault.eth_amount = read_balance(&ctx.accounts.vault_weth_ata)?;
    vault.sol_amount = read_balance(&ctx.accounts.vault_wsol_ata)?;
    vault.usdc_amount = read_balance(&ctx.accounts.vault_usdc_ata)?;

    msg!(
        "swap_assets_to_usdc done: wbtc={} weth={} wsol={} usdc={}",
        vault.btc_amount,
        vault.eth_amount,
        vault.sol_amount,
        vault.usdc_amount,
    );

    Ok(())
}

fn read_balance(ata: &UncheckedAccount) -> Result<u64> {
    if ata.data_is_empty() {
        return Ok(0);
    }
    let data = ata.try_borrow_data()?;
    Ok(TokenAccount::try_deserialize(&mut data.as_ref())?.amount)
}

#[derive(Accounts)]
pub struct SwapAssetsToUsdc<'info> {
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

    /// CHECK: Vault authority WBTC ATA — must be pre-created off-chain.
    #[account(mut)]
    pub vault_wbtc_ata: UncheckedAccount<'info>,

    #[account(address = WBTC_MINT @ ErrorCode::InvalidMint)]
    pub wbtc_mint: Account<'info, Mint>,

    /// CHECK: Vault authority WETH ATA — must be pre-created off-chain.
    #[account(mut)]
    pub vault_weth_ata: UncheckedAccount<'info>,

    #[account(address = WETH_MINT @ ErrorCode::InvalidMint)]
    pub weth_mint: Account<'info, Mint>,

    /// CHECK: Vault authority wSOL ATA — must be pre-created off-chain.
    #[account(mut)]
    pub vault_wsol_ata: UncheckedAccount<'info>,

    #[account(address = WSOL_MINT @ ErrorCode::InvalidMint)]
    pub wsol_mint: Account<'info, Mint>,

    /// CHECK: Vault authority USDC ATA — must be pre-created off-chain.
    #[account(mut)]
    pub vault_usdc_ata: UncheckedAccount<'info>,

    #[account(address = USDC_MINT @ ErrorCode::InvalidMint)]
    pub usdc_mint: Account<'info, Mint>,

    /// CHECK: Orca Whirlpool program.
    #[account(address = WHIRLPOOL_PROGRAM_ID)]
    pub whirlpool_program: UncheckedAccount<'info>,

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
}
