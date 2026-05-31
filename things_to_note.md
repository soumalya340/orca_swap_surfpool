# Things to Note: Surfpool vs solana-test-validator

## Issues encountered using Surfpool for Orca swap integration tests

---

### 1. `surfnet_setTokenAccount` does NOT create canonical ATAs

**What happened:**
`surfnet_setTokenAccount` creates token accounts at **arbitrary, non-ATA addresses** — not at the address
derived by the Associated Token Program (`findProgramAddressSync([owner, TOKEN_PROGRAM_ID, mint], ATA_PROGRAM_ID)`).

The test used `findAta()` to derive the expected vault WBTC/WETH ATA addresses, then called
`surfnet_setTokenAccount` to seed them with a balance. But surfnet created the accounts at completely
different addresses (e.g. derived: `A9axmpqJ...`, actual: `AD9tZEYg...`).

**Error:**
```
AnchorError caused by account: vault_wbtc_ata.
Error Code: AccountNotInitialized. Error Number: 3012.
```

**Lesson:**
`surfnet_setTokenAccount` is only useful for overriding balances on accounts that **already exist** at a
known address. Do NOT use it to create new token accounts you plan to pass to a program — the address
it chooses will never match your derived ATA address. Use real ATA creation via the Associated Token
Program instead (with `allowOwnerOffCurve: true` for PDA authorities).

---

### 2. Stale non-canonical accounts pollute state across runs

**What happened:**
After fixing the address mismatch by querying `getTokenAccountsByOwner()[0]` to get the actual surfnet
address, the test passed those wrong-address accounts to the program. But across multiple test runs,
`surfnet_setTokenAccount` accumulated multiple stale accounts, and `getTokenAccountsByOwner()` would
return the wrong one (an old non-ATA account from a previous run instead of the current one).

This caused the `system_program::transfer` (SOL → WSOL wrapping step) to fail because the destination
address wasn't a proper WSOL ATA.

**Error:**
```
AnchorError thrown in swap_sol_to_assets.rs:190.
Error Code: CpiFailure. Error Number: 6001.
```

**Lesson:**
When using Surfpool cheatcodes, always **clean up stale accounts** from prior runs before your test.
Add a helper like `surfnetCleanupNonCanonicalTokenAccounts()` that wipes any token accounts that don't
match the canonical ATA address.

---

### 3. Streamed oracle PDAs have bad timestamp data

**What happened:**
These Orca Whirlpool pools (SOL/WBTC, SOL/WETH) have **no initialized oracle on mainnet** — the oracle
PDA is empty. When the test streamed the oracle PDA address, Surfpool fetched stale or zero-filled data
from mainnet and materialized it locally. Orca's `swap` CPI then read the oracle timestamp and rejected
it with `InvalidTimestamp` because it didn't match Surfpool's local clock.

**Error:**
```
Error: InvalidTimestamp (6022)
```

**Lesson:**
Not all Whirlpool accounts have valid data on mainnet. Oracle PDAs are only initialized for pools that
use adaptive fees — most standard pools don't. Before streaming oracle accounts, check if the pool
actually uses one. If not, wipe the oracle PDA before calling the swap instruction:

```ts
const info = await connection.getAccountInfo(oracle);
if (info && info.data.length > 0) {
  await surfnetWipeAccount(connection, oracle);
}
```

---

### 4. Pinocchio `to_p!` CPI helpers break when calling EXTERNAL programs

**What happened:**
The original program used a `to_p!` macro to cast Anchor's `AccountInfo` into Pinocchio's `AccountInfo`
before calling external programs (system program, token program, Orca Whirlpool). This is an **unsafe
pointer cast** — it reinterprets the raw memory of one struct as another:

```rust
macro_rules! to_p {
    ($acc:expr) => {
        unsafe {
            &*(&$acc.to_account_info() as *const anchor_lang::prelude::AccountInfo
                as *const pinocchio::account_info::AccountInfo)
        }
    };
}
```

This failed because Anchor and Pinocchio have **different internal struct layouts** for `AccountInfo`.
The pointer cast silently reads the wrong memory fields, so the CPI receives corrupted account data
and fails.

---

**Why damm-v2 can do it but our program couldn't:**

This is the key insight. Looking at damm-v2's `p_helper.rs` and `ix_p_swap.rs`, their Pinocchio usage
is fundamentally different from ours:

| | damm-v2 | our orca_swap |
|---|---|---|
| **Program type** | Pinocchio-native program | Anchor program using Pinocchio as an add-on |
| **Entrypoint** | Pinocchio entrypoint — accounts arrive AS Pinocchio `AccountInfo` natively | Anchor entrypoint — accounts arrive AS Anchor `AccountInfo` |
| **CPI target** | Calls its OWN token transfer logic (pinocchio-token-2022) | Calls EXTERNAL programs (System, Token, Orca) |
| **Cast needed?** | No cast — accounts are already Pinocchio types end-to-end | YES — forced to cast Anchor → Pinocchio before every CPI |

damm-v2 is written as a **pure Pinocchio program** — it uses Pinocchio's entrypoint, so all incoming
accounts are Pinocchio `AccountInfo` from the start. No casting is ever needed. Their token CPIs use
`pinocchio_token_2022::instructions::TransferChecked` which takes native Pinocchio types.

Our program uses **Anchor's entrypoint and account validation macros** (`#[program]`, `#[derive(Accounts)]`).
Anchor hands us `AccountInfo` objects in Anchor's format. The `to_p!` hack tried to forcibly pretend
those Anchor objects were Pinocchio objects — an unsafe lie that only works if both libraries happen
to lay out memory identically, which they don't guarantee.

---

**Fix:**
Removed the `to_p!` casts entirely. Replaced all three CPIs with proper standard library calls
that work natively with Anchor `AccountInfo`:

```rust
// SOL → WSOL wrapping (was p_transfer_sol)
anchor_lang::system_program::transfer(CpiContext::new(...), sol_amount)?;

// SyncNative (was p_sync_native)
anchor_spl::token::sync_native(CpiContext::new(...))?;

// Orca Whirlpool swap (was p_orca_swap with to_p! casts)
// New anchor_orca_swap() helper uses invoke_signed() from solana_program
// with Anchor AccountInfo directly — no cast needed
invoke_signed(&ix, &[token_program, token_authority, ...], signer_seeds)?;
```

The `pinocchio_cpi.rs` file is now dead code — it still exists in the project but nothing calls it.
The `pinocchio` crate is still in `Cargo.toml` but can be removed along with the dead file.

---

**The takeaway — when CAN you use Pinocchio in Anchor programs?**

You CAN use Pinocchio for **zero-copy account deserialization** (reading/writing account data
efficiently with `bytemuck`) — that's layout-safe because you control the struct definition.

You CANNOT safely use the `to_p!` pointer-cast trick to call external programs via Pinocchio CPIs
from an Anchor program. The two runtimes have different `AccountInfo` layouts and the cast is
undefined behavior.

**Rule:** If your program is Anchor, use Anchor CPIs. If your program is pure Pinocchio, use
Pinocchio CPIs. Don't mix them at the CPI boundary with unsafe casts.

---

### Summary

| Issue | Root Cause | Fix |
|---|---|---|
| `AccountNotInitialized` on WBTC/WETH ATA | `surfnet_setTokenAccount` creates non-ATA addresses | Create real ATAs via Associated Token Program |
| `CpiFailure` on SOL transfer | Stale non-canonical account passed to program | Cleanup stale accounts + use canonical ATAs |
| `InvalidTimestamp` on Orca swap | Empty oracle PDA streamed with bad data | Wipe oracle PDA if pool doesn't use adaptive fees |
| Pinocchio CPI failures | Unsafe `AccountInfo` cast breaks on mainnet-streamed accounts | Use Anchor CPIs instead of `to_p!` macros |

---

### When to use Surfpool vs solana-test-validator

**Use Surfpool when:**
- Testing CPIs against real on-chain programs (Orca, Metaplex, etc.)
- You need real mainnet pool state (tick arrays, liquidity, prices)
- You can't realistically mock the complexity of the external protocol

**Use solana-test-validator (or LiteSVM) when:**
- Testing your own program logic in isolation
- You want fully deterministic, clean state every run
- You don't need real external program state
