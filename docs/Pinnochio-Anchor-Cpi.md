# Integrating Pinocchio zero-copy CPIs Inside Anchor Programs

This developer guide provides a step-by-step roadmap for integrating **Pinocchio’s high-performance, zero-copy CPI engine** directly inside a standard **Anchor program**. 

By combining the structural safety of Anchor (for administration and layout) with the ultra-low Compute Unit (CU) footprint of Pinocchio (for sequential swaps), you can execute complex multi-swap basket strategies (e.g., swapping `USDC → WSOL → WBTC & WETH` in a single instruction) without hitting Solana's strict 200,000 CU limit.

---

## The Hybrid Architecture Model

Solana does not limit you to a single framework. Since both Anchor and Pinocchio compile down to raw eBPF binary code, they can easily coexist:

1. **Anchor** manages your program accounts, verification, and administrative entry points (ergonomic & safe).
2. **Pinocchio** executes your high-frequency hot paths—specifically sequential CPI swaps (ultra-efficient & cheap).

---

## Step 1: Adding Dependencies

Add `pinocchio` to your Anchor program's `Cargo.toml` (e.g., inside `programs/vault/Cargo.toml`).

```toml
[dependencies]
anchor-lang = "0.30.1" # Use your current Anchor version
bytemuck = { version = "1.16.0", features = ["derive"] }
pinocchio = "0.8.0"    # High-performance zero-copy Solana SDK
```

> [!NOTE]
> Pinocchio exposes its own lightweight replacements for `AccountInfo`, `Pubkey`, `Instruction`, and `cpi` system calls that completely bypass standard heap allocation overheads.

---

## Step 2: Understanding the Orca Whirlpool Swap Layout

Because Pinocchio does not import the heavyweight Orca SDK (which would bloat your binary), we build the instruction directly from its raw binary layout.

An Orca Whirlpool `swap` or `swap_v2` instruction has this binary layout:
1. **8-Byte Discriminator**: The unique identifier for the instruction. For Orca Whirlpool's standard `swap`, this is:
   `[248, 198, 244, 111, 252, 9, 219, 145]`
2. **Instruction Parameters**:
   * `amount` (`u64`): The amount of input token.
   * `other_amount_threshold` (`u64`): Minimum output slippage protection.
   * `sqrt_price_limit` (`u128`): Price boundary limit.
   * `amount_specified_is_input` (`bool`): Direct exact-in swap flags.
   * `a_to_b` (`bool`): Direction of the swap.

We will serialize these arguments on the **stack** (which is free) rather than using the Borsh encoder (which consumes thousands of CUs).

---

## Step 3: Writing the Pinocchio CPI Helper

Create a helper function in your program (e.g. under `utils/pinocchio_cpi.rs`). This function uses Pinocchio's zero-copy structures to build and invoke the CPI signed by your Vault PDA authority.

```rust
use pinocchio::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Instruction, Signer},
    cpi::invoke_signed,
    entrypoint::ProgramResult,
};

/// High-Performance Zero-Copy Orca Swap via Pinocchio
pub fn p_orca_swap(
    orca_program: &AccountInfo,
    vault_authority: &AccountInfo,
    whirlpool: &AccountInfo,
    token_ata_in: &AccountInfo,
    token_ata_out: &AccountInfo,
    token_vault_a: &AccountInfo,
    token_vault_b: &AccountInfo,
    tick_array_0: &AccountInfo,
    tick_array_1: &AccountInfo,
    tick_array_2: &AccountInfo,
    oracle: &AccountInfo,
    token_program: &AccountInfo,
    vault_authority_bump: u8,
    amount: u64,
    min_out: u64,
    a_to_b: bool,
) -> ProgramResult {
    
    // 1. Build PDA Signers on the stack using the Pinocchio macro
    let seeds = pinocchio::seeds!(
        b"vault_authority",
        &[vault_authority_bump]
    );
    let signers = &[Signer::from(&seeds)];

    // 2. Define Orca Whirlpool Swap's exact flat accounts list (11 accounts)
    let accounts = [
        AccountMeta::new_readonly(token_program.key(), false),
        AccountMeta::new_readonly(vault_authority.key(), true), // Signer
        AccountMeta::new(whirlpool.key(), false),
        AccountMeta::new(token_ata_in.key(), false),
        AccountMeta::new(token_ata_out.key(), false),
        AccountMeta::new(token_vault_a.key(), false),
        AccountMeta::new(token_vault_b.key(), false),
        AccountMeta::new(tick_array_0.key(), false),
        AccountMeta::new(tick_array_1.key(), false),
        AccountMeta::new(tick_array_2.key(), false),
        AccountMeta::new_readonly(oracle.key(), false),
    ];

    // 3. Serialize parameters directly to the stack (No Borsh overhead!)
    // Layout size: 8 (disc) + 8 (amount) + 8 (min_out) + 16 (sqrt_price_limit) + 1 (is_input) + 1 (a_to_b) = 42 bytes
    let mut instruction_data = [0u8; 42];
    
    // Copy Orca Swap 8-byte discriminator
    instruction_data[0..8].copy_from_slice(&[248, 198, 244, 111, 252, 9, 219, 145]);
    // Copy amount (u64)
    instruction_data[8..16].copy_from_slice(&amount.to_le_bytes());
    // Copy other_amount_threshold (u64)
    instruction_data[16..24].copy_from_slice(&min_out.to_le_bytes());
    // Copy sqrt_price_limit (u128 - set standard bounds depending on a_to_b)
    let sqrt_price_limit: u128 = if a_to_b { 4295458998 } else { 79228162514264337593543950335 };
    instruction_data[24..40].copy_from_slice(&sqrt_price_limit.to_le_bytes());
    // Copy amount_specified_is_input (bool = true)
    instruction_data[40] = 1;
    // Copy a_to_b (bool)
    instruction_data[41] = if a_to_b { 1 } else { 0 };

    // 4. Create the raw Pinocchio Instruction
    let instruction = Instruction {
        program_id: orca_program.key(),
        accounts: &accounts,
        data: &instruction_data,
    };

    // 5. Invoke the system call directly
    invoke_signed(
        &instruction,
        &[
            token_program,
            vault_authority,
            whirlpool,
            token_ata_in,
            token_ata_out,
            token_vault_a,
            token_vault_b,
            tick_array_0,
            tick_array_1,
            tick_array_2,
            oracle,
        ],
        signers,
    )?;

    Ok(())
}
```

---

## Step 4: Integrating inside the Anchor Instruction

Now, wire the helper inside your standard Anchor handler. Since Anchor's `AccountInfo` and Pinocchio's `AccountInfo` are structurally identical at the ABI boundary, you can safely cast them using a raw pointer conversion.

### The Anchor Context:
Declare the instruction context exactly as normal in Anchor:

```rust
use anchor_lang::prelude::*;
use crate::state::Vault;

#[derive(Accounts)]
pub struct SwapWsolToAssets<'info> {
    pub vault: AccountLoader<'info, Vault>,
    /// CHECK: PDA signer
    pub vault_authority: UncheckedAccount<'info>,
    /// CHECK: Orca program
    pub orca_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    
    // --- Shared input token (WSOL) ---
    pub vault_wsol_ata: Account<'info, TokenAccount>,

    // --- Asset 1: SOL / WBTC Accounts ---
    pub wbtc_whirlpool: UncheckedAccount<'info>,
    pub vault_wbtc_ata: Account<'info, TokenAccount>,
    pub wbtc_vault_a: UncheckedAccount<'info>,
    pub wbtc_vault_b: UncheckedAccount<'info>,
    pub wbtc_tick_array_0: UncheckedAccount<'info>,
    pub wbtc_tick_array_1: UncheckedAccount<'info>,
    pub wbtc_tick_array_2: UncheckedAccount<'info>,
    pub wbtc_oracle: UncheckedAccount<'info>,

    // --- Asset 2: SOL / WETH Accounts ---
    pub weth_whirlpool: UncheckedAccount<'info>,
    pub vault_weth_ata: Account<'info, TokenAccount>,
    pub weth_vault_a: UncheckedAccount<'info>,
    pub weth_vault_b: UncheckedAccount<'info>,
    pub weth_tick_array_0: UncheckedAccount<'info>,
    pub weth_tick_array_1: UncheckedAccount<'info>,
    pub weth_tick_array_2: UncheckedAccount<'info>,
    pub weth_oracle: UncheckedAccount<'info>,
}
```

### The Anchor Handler (Executing Multiple CPIs):
To pass Anchor's `AccountInfo` references to Pinocchio, simply cast them using `unsafe { &*(anchor_ref as *const _ as *const pinocchio::account_info::AccountInfo) }`:

```rust
pub fn handle_swap_wsol_to_assets(
    ctx: Context<SwapWsolToAssets>,
    wbtc_amount_in: u64,
    wbtc_min_out: u64,
    wbtc_a_to_b: bool,
    weth_amount_in: u64,
    weth_min_out: u64,
    weth_a_to_b: bool,
) -> Result<()> {
    let vault = ctx.accounts.vault.load()?;
    let bump = vault.authority_bump;

    // Helper macro to cast Anchor AccountInfo to Pinocchio AccountInfo
    macro_rules! to_p {
        ($acc:expr) => {
            unsafe { &*(&$acc.to_account_info() as *const _ as *const pinocchio::account_info::AccountInfo) }
        };
    }

    // ─── Swap 1: SOL -> WBTC (Pinocchio) ───────────────────────────────────
    p_orca_swap(
        to_p!(ctx.accounts.orca_program),
        to_p!(ctx.accounts.vault_authority),
        to_p!(ctx.accounts.wbtc_whirlpool),
        to_p!(ctx.accounts.vault_wsol_ata),
        to_p!(ctx.accounts.vault_wbtc_ata),
        to_p!(ctx.accounts.wbtc_vault_a),
        to_p!(ctx.accounts.wbtc_vault_b),
        to_p!(ctx.accounts.wbtc_tick_array_0),
        to_p!(ctx.accounts.wbtc_tick_array_1),
        to_p!(ctx.accounts.wbtc_tick_array_2),
        to_p!(ctx.accounts.wbtc_oracle),
        to_p!(ctx.accounts.token_program),
        bump,
        wbtc_amount_in,
        wbtc_min_out,
        wbtc_a_to_b,
    ).map_err(|_| error!(ErrorCode::CpiFailure))?;

    // ─── Swap 2: SOL -> WETH (Pinocchio) ───────────────────────────────────
    p_orca_swap(
        to_p!(ctx.accounts.orca_program),
        to_p!(ctx.accounts.vault_authority),
        to_p!(ctx.accounts.weth_whirlpool),
        to_p!(ctx.accounts.vault_wsol_ata),
        to_p!(ctx.accounts.vault_weth_ata),
        to_p!(ctx.accounts.weth_vault_a),
        to_p!(ctx.accounts.weth_vault_b),
        to_p!(ctx.accounts.weth_tick_array_0),
        to_p!(ctx.accounts.weth_tick_array_1),
        to_p!(ctx.accounts.weth_tick_array_2),
        to_p!(ctx.accounts.weth_oracle),
        to_p!(ctx.accounts.token_program),
        bump,
        weth_amount_in,
        weth_min_out,
        weth_a_to_b,
    ).map_err(|_| error!(ErrorCode::CpiFailure))?;

    Ok(())
}
```

---

## Performance Auditing Checklist

To guarantee you remain within the **200,000 Compute Unit** boundary:

| Optimisation | Target CU Savings | Status |
|---|---|---|
| **Zero-Copy State** | **~15,000 CUs** | Load `Vault` with `AccountLoader` instead of `Account` |
| **Borsh-Free Serialization** | **~8,000 CUs** | Build the swap transaction raw onto stack arrays |
| **Direct Pointers** | **~5,000 CUs** | Bypass Anchor's `CpiContext` builder stack frame |
| **Combined CPI Functions** | **~20,000 CUs** | Perform multiple swaps inside one instruction instead of multiple transactions |

Using this hybrid architecture, your index vault will run circles around standard Anchor programs in terms of gas fees and reliability. Happy coding!
