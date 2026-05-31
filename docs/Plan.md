# Plan: SOL → WSOL → WBTC + WETH in One Transaction (Pinocchio CPI)

---

## 1. Goal

Build **one Anchor instruction** on `orca_swap` that, in a **single transaction**, does all of this:

1. **Wrap SOL → WSOL** — transfer native lamports into the vault’s WSOL token account and call `SyncNative`.
2. **Swap WSOL → WBTC** — CPI into Orca Whirlpool (`deps/whirlpools/programs`).
3. **Swap WSOL → WETH** — second CPI into a different Whirlpool pool.

All **hot-path CPIs** (System transfer, SyncNative, both Orca swaps) must use **Pinocchio** — not Anchor’s `CpiContext` — to keep compute units low. Anchor stays as the outer shell for account validation, admin checks, and Vault state.

**Why Pinocchio inside Anchor?**  
Reference: `Pinnochio-Anchor-Cpi.md` and live pattern in `deps/damm-v2/programs/cp-amm` — Anchor for safety, Pinocchio for cheap sequential CPIs.

---

## 2. Tasks (what needs to be done)

### Phase A — Program foundation

| # | Task | Status |
|---|---|---|
| A1 | Add `pinocchio` dependency to `programs/orca_swap/Cargo.toml` (same git rev as damm-v2) | Todo |
| A2 | Split `lib.rs` into modules: `constants`, `state`, `utils/pinocchio_cpi`, `instructions/` | Todo |
| A3 | Add `vault_authority` PDA (`seeds = [b"vault_authority"]`) — signs all token + swap CPIs | Todo |
| A4 | Extend `Vault` state: `accepted_mint_key`, `authority_bump` | Todo |
| A5 | Gate admin-only instructions with `ADMIN_PUBKEY` (already planned in prior work) | Todo |

### Phase B — Pinocchio CPI helpers

| # | Task | Status |
|---|---|---|
| B1 | `to_p!` macro — cast Anchor `AccountInfo` → Pinocchio `AccountInfo` (unsafe pointer cast) | Todo |
| B2 | `p_transfer_sol` — System Program CPI: admin → vault WSOL ATA | Todo |
| B3 | `p_sync_native` — Token Program CPI: refresh WSOL ATA `amount` after lamport transfer | Todo |
| B4 | `p_orca_swap` — Whirlpool `swap` CPI with stack-serialized 42-byte instruction data | Todo |

### Phase C — Main instruction

| # | Task | Status |
|---|---|---|
| C1 | Define `swap_sol_to_assets` instruction + `SwapSolToAssets` accounts struct | Todo |
| C2 | Wire handler: wrap SOL → swap WBTC → swap WETH (3 Pinocchio CPIs + 2 Orca CPIs) | Todo |
| C3 | Validate args: `wbtc_amount_in + weth_amount_in <= sol_amount` | Todo |
| C4 | Map errors: Pinocchio failure → `ErrorCode::CpiFailure` | Todo |

### Phase D — Client & testing

| # | Task | Status |
|---|---|---|
| D1 | `anchor build` — regenerate IDL/types | Todo |
| D2 | Keep existing LiteSVM `initialize` test passing | Todo |
| D3 | LiteSVM integration test: clone mainnet Whirlpool accounts + run full swap (like `deps/oracle_practice/tests/oracle_live_accounts.test.ts`) | Todo |
| D4 | CU comparison note (optional): log compute used vs hypothetical Anchor CPI | Todo |

---

## 3. How we will do it

### 3.1 Hybrid architecture

```
Client tx
    │
    ▼
┌──────────────────────────────────────┐
│  Anchor: swap_sol_to_assets          │
│  • validate accounts & admin         │
│  • check amount sums                 │
└──────────────┬───────────────────────┘
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
 p_transfer   p_sync    p_orca_swap ×2
   _sol      _native    (WBTC + WETH)
    │          │          │
    ▼          ▼          ▼
 System     Token      Whirlpool
 Program    Program    whirLbMiic...
```

| Layer | Tool | Job |
|---|---|---|
| Shell | Anchor | Account constraints, Vault, admin gate, IDL |
| Hot path | Pinocchio | Raw CPI: stack bytes, no Borsh, no `CpiContext` |
| Types (optional) | `libs/orca_whirlpool` | `declare_program!` from IDL — for future typed Anchor CPI if needed |
| Ground truth | `idls/orca_whirlpool.json` + `deps/whirlpools/programs/whirlpool` | Discriminator, account order, sqrt limits |

---

### 3.2 Instruction design: `swap_sol_to_assets`

#### Arguments

| Arg | Type | Purpose |
|---|---|---|
| `sol_amount` | `u64` | Lamports to wrap into WSOL |
| `wbtc_amount_in` | `u64` | WSOL to spend on WBTC pool |
| `wbtc_min_out` | `u64` | Slippage floor for WBTC |
| `wbtc_a_to_b` | `bool` | Direction on WBTC pool |
| `weth_amount_in` | `u64` | WSOL to spend on WETH pool |
| `weth_min_out` | `u64` | Slippage floor for WETH |
| `weth_a_to_b` | `bool` | Direction on WETH pool |

**Rule:** `wbtc_amount_in + weth_amount_in <= sol_amount`

#### Accounts (high level)

```
signer                 — admin (address = ADMIN_PUBKEY)
vault                  — mut, our state
vault_authority        — PDA [b"vault_authority"], signs CPIs
system_program
token_program

vault_wsol_ata         — mut, authority-owned WSOL ATA
vault_wbtc_ata         — mut, authority-owned WBTC ATA
vault_weth_ata         — mut, authority-owned WETH ATA

whirlpool_program      — whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc

── WBTC pool (11 accounts per Orca swap) ──
wbtc_whirlpool, wbtc_token_owner_a, wbtc_vault_a,
wbtc_token_owner_b, wbtc_vault_b,
wbtc_tick_array_0, wbtc_tick_array_1, wbtc_tick_array_2, wbtc_oracle

── WETH pool (same 11-account layout) ──
weth_whirlpool, ...
```

**Client responsibility:**  
- Create vault ATAs before calling (keeps instruction CU low).  
- Pass correct tick arrays for current pool price.  
- Map vault ATAs to `token_owner_account_a` or `_b` based on each pool’s mint ordering.  
- Set `a_to_b` correctly per pool.

---

### 3.3 Execution flow (step by step)

```
Step 0  Admin signs tx; all accounts validated by Anchor constraints.

Step 1  p_transfer_sol
        • From: admin signer
        • To:   vault_wsol_ata
        • Amount: sol_amount
        • CPI: System Program (discriminator 2, u64 lamports)

Step 2  p_sync_native
        • Account: vault_wsol_ata
        • CPI: Token Program (discriminator 17)
        • Effect: WSOL ATA amount field = lamports above rent

Step 3  p_orca_swap (WBTC pool)
        • token_authority = vault_authority PDA (invoke_signed)
        • Input/output = vault ATAs mapped to pool A/B sides
        • Args: wbtc_amount_in, wbtc_min_out, a_to_b

Step 4  p_orca_swap (WETH pool)
        • Same pattern, different pool accounts
        • Args: weth_amount_in, weth_min_out, a_to_b

Step 5  (Optional v1) Update Vault.btc_amount / eth_amount / sol_amount
        • Can read ATA balances or defer to client
```

---

### 3.4 Pinocchio CPI details

#### SOL → WSOL wrap

| Step | Program | Instruction | Stack data |
|---|---|---|---|
| Transfer | System | Transfer | `[2u32 LE][lamports u64 LE]` (12 bytes) |
| Sync | Token | SyncNative | `[17]` (1 byte) |

Pattern reference: `deps/whirlpools/programs/whirlpool/src/pinocchio/cpi/system_transfer.rs`

#### Orca Whirlpool `swap`

**Source of truth:** `idls/orca_whirlpool.json` (not the stale discriminator in `Pinnochio-Anchor-Cpi.md`).

```
discriminator: [248, 198, 158, 145, 225, 117, 135, 200]

data (42 bytes on stack):
  [0..8]   discriminator
  [8..16]  amount (u64)
  [16..24] other_amount_threshold (u64)
  [24..40] sqrt_price_limit (u128)
  [40]     amount_specified_is_input = 1
  [41]     a_to_b (0 or 1)

sqrt_price_limit:
  a_to_b = true  → MIN_SQRT_PRICE_X64 = 4295048016
  a_to_b = false → MAX_SQRT_PRICE_X64 = 79226673515401279992447579055
```

**Account order (11 accounts):**

1. `token_program` (readonly)
2. `token_authority` (signer — vault_authority PDA)
3. `whirlpool` (writable)
4. `token_owner_account_a` (writable)
5. `token_vault_a` (writable)
6. `token_owner_account_b` (writable)
7. `token_vault_b` (writable)
8. `tick_array_0` (writable)
9. `tick_array_1` (writable)
10. `tick_array_2` (writable)
11. `oracle` (readonly PDA: seeds `[b"oracle", whirlpool]`)

#### Anchor ↔ Pinocchio bridge

```rust
// Cast Anchor AccountInfo to Pinocchio AccountInfo at ABI boundary
macro_rules! to_p {
    ($acc:expr) => {
        unsafe { &*(&$acc.to_account_info() as *const _ as *const pinocchio::account_info::AccountInfo) }
    };
}
```

Reference: `Pinnochio-Anchor-Cpi.md` § Step 4, `deps/damm-v2/programs/cp-amm/src/instructions/swap/ix_p_swap.rs`

---

### 3.5 File layout (after implementation)

```
programs/orca_swap/src/
  lib.rs                      — #[program] mod, re-exports
  constants.rs                — ADMIN, WHIRLPOOL, discriminators, sqrt limits
  state.rs                    — Vault, ErrorCode
  utils/
    mod.rs
    pinocchio_cpi.rs          — to_p!, p_transfer_sol, p_sync_native, p_orca_swap
  instructions/
    mod.rs
    initialize.rs
    swap_sol_to_assets.rs

programs/orca_swap/Cargo.toml — + pinocchio (git rev matching damm-v2)
```

Existing assets we reuse (no rewrite):

```
idls/orca_whirlpool.json           — swap layout
libs/orca_whirlpool/               — declare_program! wrapper
deps/whirlpools/programs/whirlpool — swap handler + tick math
deps/damm-v2/programs/cp-amm/      — Pinocchio + Anchor hybrid reference
Pinnochio-Anchor-Cpi.md            — design doc
```

---

### 3.6 Testing strategy

| Phase | What | How |
|---|---|---|
| Build | Program compiles with Pinocchio | `anchor build` |
| Smoke | Initialize still works | `yarn test:litesvm` (existing test) |
| Integration | Full swap path | LiteSVM + clone mainnet Whirlpool pool accounts (pattern from `oracle_live_accounts.test.ts`) |
| CU audit | Confirm Pinocchio savings | Compare logs / compute budget (optional) |

Integration test needs real mainnet pool addresses for SOL/WBTC and SOL/WETH whirlpools — to be picked when implementing Phase D.

---

### 3.7 Risks & decisions

| Risk | Mitigation |
|---|---|
| Stale swap discriminator in `Pinnochio-Anchor-Cpi.md` | Always use `idls/orca_whirlpool.json` |
| Wrong `a_to_b` or ATA side mapping | Client must match pool mint order; document in test |
| Tick arrays wrong for current price | Client passes arrays (standard Orca SDK behavior) |
| ATAs don’t exist | Client creates ATAs before calling instruction |
| CU budget on 2 swaps | Pinocchio stack CPIs; single instruction not 3 separate txs |
| `orca_whirlpool` Anchor CPI crate | Keep for future; hot path uses raw Pinocchio bytes, not Anchor CPI builder |

---

### 3.8 Implementation order (when we start coding)

1. `constants.rs` + `state.rs` + pinocchio dep  
2. `utils/pinocchio_cpi.rs` — helpers only, no instruction yet  
3. `instructions/swap_sol_to_assets.rs` — accounts struct + handler  
4. Update `initialize` for `vault_authority` + `authority_bump`  
5. `anchor build` + fix compile errors  
6. LiteSVM smoke test  
7. LiteSVM integration test with cloned pools (follow-up)

---

## 4. Current repo baseline

What exists today:

- `programs/orca_swap/src/lib.rs` — `initialize` + basic `Vault` (btc/eth/sol amounts only)
- `libs/orca_whirlpool` — IDL wrapper via `declare_program!`
- `idls/orca_whirlpool.json` — full Whirlpool IDL
- `programs/orca_swap/Cargo.toml` — `orca_whirlpool` path dep already wired
- `tests/orca_swap.ts` — LiteSVM initialize test
- `Pinnochio-Anchor-Cpi.md` — hybrid CPI design doc

What does **not** exist yet:

- Pinocchio dependency
- `swap_sol_to_assets` instruction
- Pinocchio CPI helpers
- Vault authority PDA
- Integration test for swaps

---

## 5. Success criteria

- [ ] One instruction wraps SOL and performs two Orca swaps in one tx  
- [ ] All CPIs on the hot path use Pinocchio (not Anchor `CpiContext`)  
- [ ] Program builds and existing initialize test passes  
- [ ] Integration test demonstrates full flow against cloned Whirlpool accounts (Phase D)
