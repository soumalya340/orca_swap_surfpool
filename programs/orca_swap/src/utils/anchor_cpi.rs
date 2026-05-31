use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

use crate::constants::{
    MAX_SQRT_PRICE_X64, MIN_SQRT_PRICE_X64, VAULT_AUTHORITY_SEED, WHIRLPOOL_SWAP_DISCRIMINATOR,
};

/// Orca Whirlpool `swap` CPI using Anchor `AccountInfo` (avoids Pinocchio ABI casts).
#[allow(clippy::too_many_arguments)]
pub fn anchor_orca_swap<'info>(
    whirlpool_program: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    token_authority: AccountInfo<'info>,
    whirlpool: AccountInfo<'info>,
    token_owner_account_a: AccountInfo<'info>,
    token_vault_a: AccountInfo<'info>,
    token_owner_account_b: AccountInfo<'info>,
    token_vault_b: AccountInfo<'info>,
    tick_array_0: AccountInfo<'info>,
    tick_array_1: AccountInfo<'info>,
    tick_array_2: AccountInfo<'info>,
    oracle: AccountInfo<'info>,
    authority_bump: u8,
    amount: u64,
    min_out: u64,
    a_to_b: bool,
) -> Result<()> {
    let bump = [authority_bump];
    let signer_seeds: &[&[&[u8]]] = &[&[VAULT_AUTHORITY_SEED, &bump]];

    let sqrt_price_limit = if a_to_b {
        MIN_SQRT_PRICE_X64
    } else {
        MAX_SQRT_PRICE_X64
    };

    let mut data = [0u8; 42];
    data[..8].copy_from_slice(&WHIRLPOOL_SWAP_DISCRIMINATOR);
    data[8..16].copy_from_slice(&amount.to_le_bytes());
    data[16..24].copy_from_slice(&min_out.to_le_bytes());
    data[24..40].copy_from_slice(&sqrt_price_limit.to_le_bytes());
    data[40] = 1; // amount_specified_is_input = true
    data[41] = u8::from(a_to_b);

    let accounts = vec![
        AccountMeta::new_readonly(token_program.key(), false),
        AccountMeta::new_readonly(token_authority.key(), true),
        AccountMeta::new(whirlpool.key(), false),
        AccountMeta::new(token_owner_account_a.key(), false),
        AccountMeta::new(token_vault_a.key(), false),
        AccountMeta::new(token_owner_account_b.key(), false),
        AccountMeta::new(token_vault_b.key(), false),
        AccountMeta::new(tick_array_0.key(), false),
        AccountMeta::new(tick_array_1.key(), false),
        AccountMeta::new(tick_array_2.key(), false),
        AccountMeta::new_readonly(oracle.key(), false),
    ];

    let ix = Instruction {
        program_id: whirlpool_program.key(),
        accounts,
        data: data.to_vec(),
    };

    invoke_signed(
        &ix,
        &[
            token_program,
            token_authority,
            whirlpool,
            token_owner_account_a,
            token_vault_a,
            token_owner_account_b,
            token_vault_b,
            tick_array_0,
            tick_array_1,
            tick_array_2,
            oracle,
        ],
        signer_seeds,
    )
    .map_err(|_| error!(crate::state::ErrorCode::CpiFailure))?;

    Ok(())
}
