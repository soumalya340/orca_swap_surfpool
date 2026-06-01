use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::{ADMIN_PUBKEY, USDC_MINT, WBTC_MINT, WETH_MINT, VAULT_AUTHORITY_SEED};
use crate::state::Vault;

fn distribute<'info>(
    token_program: AccountInfo<'info>,
    vault_ata: &mut Account<'info, TokenAccount>,
    admin_ata: AccountInfo<'info>,
    vault_authority: AccountInfo<'info>,
    vault_amount_field: &mut u64,
    bump: u8,
    label: &str,
) -> Result<()> {
    let amount = *vault_amount_field;
    if amount == 0 {
        return Ok(());
    }

    let signer_seeds: &[&[&[u8]]] = &[&[VAULT_AUTHORITY_SEED, &[bump]]];
    token::transfer(
        CpiContext::new_with_signer(
            token_program,
            Transfer {
                from: vault_ata.to_account_info(),
                to: admin_ata,
                authority: vault_authority,
            },
            signer_seeds,
        ),
        amount,
    )?;

    vault_ata.reload()?;
    *vault_amount_field = vault_ata.amount;

    msg!("distribute_{}: sent {} to admin", label, amount);
    Ok(())
}

pub fn handle_distribute_all(ctx: Context<DistributeAll>) -> Result<()> {
    let bump = ctx.accounts.vault.authority_bump;

    // USDC
    {
        let vault_amount = &mut ctx.accounts.vault.usdc_amount;
        distribute(
            ctx.accounts.token_program.to_account_info(),
            &mut ctx.accounts.vault_usdc_ata,
            ctx.accounts.admin_usdc_ata.to_account_info(),
            ctx.accounts.vault_authority.to_account_info(),
            vault_amount,
            bump,
            "usdc",
        )?;
    }

    // WBTC
    {
        let vault_amount = &mut ctx.accounts.vault.btc_amount;
        distribute(
            ctx.accounts.token_program.to_account_info(),
            &mut ctx.accounts.vault_wbtc_ata,
            ctx.accounts.admin_wbtc_ata.to_account_info(),
            ctx.accounts.vault_authority.to_account_info(),
            vault_amount,
            bump,
            "wbtc",
        )?;
    }

    // WETH
    {
        let vault_amount = &mut ctx.accounts.vault.eth_amount;
        distribute(
            ctx.accounts.token_program.to_account_info(),
            &mut ctx.accounts.vault_weth_ata,
            ctx.accounts.admin_weth_ata.to_account_info(),
            ctx.accounts.vault_authority.to_account_info(),
            vault_amount,
            bump,
            "weth",
        )?;
    }

    Ok(())
}

#[derive(Accounts)]
pub struct DistributeAll<'info> {
    pub caller: Signer<'info>,

    #[account(mut)]
    pub vault: Account<'info, Vault>,

    /// CHECK: PDA signer for vault token transfers.
    #[account(
        seeds = [VAULT_AUTHORITY_SEED],
        bump = vault.authority_bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    // ── USDC ─────────────────────────────────────────────────────────────────
    #[account(address = USDC_MINT)]
    pub usdc_mint: Account<'info, Mint>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = vault_authority,
    )]
    pub vault_usdc_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = ADMIN_PUBKEY,
    )]
    pub admin_usdc_ata: Account<'info, TokenAccount>,

    // ── WBTC ─────────────────────────────────────────────────────────────────
    #[account(address = WBTC_MINT)]
    pub wbtc_mint: Account<'info, Mint>,

    #[account(
        mut,
        token::mint = wbtc_mint,
        token::authority = vault_authority,
    )]
    pub vault_wbtc_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = wbtc_mint,
        token::authority = ADMIN_PUBKEY,
    )]
    pub admin_wbtc_ata: Account<'info, TokenAccount>,

    // ── WETH ─────────────────────────────────────────────────────────────────
    #[account(address = WETH_MINT)]
    pub weth_mint: Account<'info, Mint>,

    #[account(
        mut,
        token::mint = weth_mint,
        token::authority = vault_authority,
    )]
    pub vault_weth_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = weth_mint,
        token::authority = ADMIN_PUBKEY,
    )]
    pub admin_weth_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
