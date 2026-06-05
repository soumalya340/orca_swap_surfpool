# Orca Swap — Test Case Design

## Program Instructions Under Test

| Instruction         | What it does                                                                      |
|---------------------|-----------------------------------------------------------------------------------|
| `initialize`        | Creates the `Vault` PDA (seeded `[b"vault", admin_pubkey]`), stores authority bump |
| `swap_sol_to_assets`| Wraps SOL → wSOL ATA, then swaps half to WBTC and half to WETH via two Orca Whirlpool CPIs |
| `swap_wsol_to_usdc` | Wraps SOL → wSOL ATA via `system_transfer + sync_native`, swaps wSOL → USDC via Orca Whirlpool CPI |
| `distribute_all`    | Transfers vault's USDC, WBTC, and WETH balances to the admin's ATAs              |

---

## How to Run the Validator

The `start:validator` npm script (or the `misc.md` command) clones the mainnet pool
state accounts into the local test validator at startup. Run it before any test:

```bash
solana-test-validator \
  --bpf-program whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc tests/programs/orca-whirlpool.so \
  --clone 2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ \
  --clone B5EwJVDuAauzUEEdwvbuXzbFFgEYnUqqS37TUM1c4PQA \
  --clone HktfL7iwGKT5QHjywQkcDnZXScoh811k7akrMZJkCcEF \
  --clone Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE \
  --url mainnet-beta \
  --reset
```

The `--clone` flags pull the pool state accounts from mainnet-beta at validator
start. Token mints, pool vaults, and tick arrays are also fetched from mainnet-beta
via `--url mainnet-beta` — the validator transparently proxies any account it does
not have locally.

---

## Pointers for Writing the Test

### Pointer 1: Parse pool state to derive accounts

After the validator starts, fetch the cloned pool account and parse it to extract
`tokenMintA`, `tokenMintB`, `tokenVaultA`, `tokenVaultB`, `tickSpacing`, and
`tickCurrentIndex`. The `@orca-so/whirlpools-client` package exposes `fetchWhirlpool`
for this:

```ts
import { fetchWhirlpool } from "@orca-so/whirlpools-client";

const pool = await fetchWhirlpool(connection, WSOL_USDC_POOL);
// pool.data.tokenMintA, pool.data.tokenMintB, pool.data.tickCurrentIndex ...
```

---

### Pointer 2: Derive `a_to_b` direction from pool state

```ts
const aToB = pool.data.tokenMintA.equals(WSOL_MINT);
```

- `aToB = true`  → selling token A (wSOL) for token B (USDC / WBTC / WETH)
- `aToB = false` → selling token B for token A

Token owner accounts passed to the swap instruction follow from this:

```ts
tokenOwnerA = aToB ? vaultWsolAta : vaultOutputAta;
tokenOwnerB = aToB ? vaultOutputAta : vaultWsolAta;
```

---

### Pointer 3: Tick array derivation formula

Tick arrays must be passed to every Whirlpool swap CPI. Derive the three PDAs from
the current tick index and tick spacing:

```ts
const TICK_ARRAY_SIZE = 88;
const ticksPerArray  = TICK_ARRAY_SIZE * pool.data.tickSpacing;
const start0 = Math.floor(pool.data.tickCurrentIndex / ticksPerArray) * ticksPerArray;
const start1 = start0 - ticksPerArray;   // one array below
const start2 = start0 + ticksPerArray;   // one array above

const [tickArray0] = PublicKey.findProgramAddressSync(
  [Buffer.from("tick_array"), poolPubkey.toBuffer(), Buffer.from(start0.toString())],
  WHIRLPOOL_PROGRAM_ID,
);
// repeat for start1 → tickArray1, start2 → tickArray2
```

Because the test-validator proxies unknown accounts from mainnet-beta, the tick
array accounts are fetched automatically on first access — no explicit cloning
step is needed.

---

### Pointer 4: Oracle PDA derivation

The WSOL/USDC pool has an on-chain oracle PDA. Derive it with:

```ts
const [oracle] = PublicKey.findProgramAddressSync(
  [Buffer.from("oracle"), poolPubkey.toBuffer()],
  WHIRLPOOL_PROGRAM_ID,
);
```

Pass this as `usdcOracle` in the swap instruction accounts.

---

### Pointer 5: ATAs that the program creates vs. ATAs the test must pre-create

| Account              | Created by             | Notes |
|----------------------|------------------------|-------|
| `vault_wsol_ata`     | Program (idempotent)   | Created inside `swap_wsol_to_usdc` |
| `vault_usdc_ata`     | Program (idempotent)   | Created inside `swap_wsol_to_usdc` |
| `vault_wbtc_ata`     | Test (pre-create)      | Must exist before `distribute_all` |
| `vault_weth_ata`     | Test (pre-create)      | Must exist before `distribute_all` |
| `admin_usdc_ata`     | Test (pre-create)      | Owner = `ADMIN_PUBKEY`; required by `distribute_all` |
| `admin_wbtc_ata`     | Test (pre-create)      | Owner = `ADMIN_PUBKEY`; required by `distribute_all` |
| `admin_weth_ata`     | Test (pre-create)      | Owner = `ADMIN_PUBKEY`; required by `distribute_all` |

Use `createAssociatedTokenAccountIdempotentInstruction` so pre-creates are safe to
call even when an ATA already exists from a previous run.

---

### Pointer 6: `distribute_all` skips zero-balance vaults gracefully

The on-chain `distribute()` helper returns `Ok(())` immediately if `vault_amount == 0`,
so the test can call `distribute_all` even when WBTC and WETH balances are zero. Only
USDC will actually transfer.

---

### Pointer 7: Test ordering dependency

```
Test Case 1 (initialize)
    ↓
Test Case 2 (swap_wsol_to_usdc)  ← requires vault to exist
    ↓
Test Case 3 (distribute_all)     ← requires vault USDC > 0
```

Each test re-checks preconditions and calls `initialize()` if the vault is missing,
so tests can also run individually during development. To wipe state between full
runs, restart the validator with `--reset`.

---

## Shared Setup (Pseudo Code)

```ts
provider  = AnchorProvider.env()
program   = workspace.orcaSwap
signer    = provider.wallet.publicKey   // must equal ADMIN_PUBKEY

[vaultPda]       = findPDA([VAULT_SEED, signer.toBytes()], programId)
[vaultAuthority] = findPDA([VAULT_AUTHORITY_SEED], programId)

// Fetch and parse the WSOL/USDC pool from the local validator
// (cloned from mainnet at startup)
usdcPool    = await fetchWhirlpool(connection, WSOL_USDC_POOL)
aToB        = usdcPool.data.tokenMintA.equals(WSOL_MINT)
usdcMint    = aToB ? usdcPool.data.tokenMintB : usdcPool.data.tokenMintA

vaultWsolAta = findAta(vaultAuthority, WSOL_MINT)
vaultUsdcAta = findAta(vaultAuthority, usdcMint)

tokenOwnerA = aToB ? vaultWsolAta : vaultUsdcAta
tokenOwnerB = aToB ? vaultUsdcAta : vaultWsolAta

// Tick arrays
ticksPerArray = 88 * usdcPool.data.tickSpacing
start0 = floor(usdcPool.data.tickCurrentIndex / ticksPerArray) * ticksPerArray
[tickArray0] = findPDA([b"tick_array", WSOL_USDC_POOL, start0], WHIRLPOOL_PROGRAM_ID)
[tickArray1] = findPDA([b"tick_array", WSOL_USDC_POOL, start0 - ticksPerArray], WHIRLPOOL_PROGRAM_ID)
[tickArray2] = findPDA([b"tick_array", WSOL_USDC_POOL, start0 + ticksPerArray], WHIRLPOOL_PROGRAM_ID)

// Oracle
[oracle] = findPDA([b"oracle", WSOL_USDC_POOL], WHIRLPOOL_PROGRAM_ID)
```

---

## Test Case 1: Initialize — Vault PDA Created with Zero Balances

**What is tested**: `initialize` instruction creates the `Vault` PDA and sets all
token amount fields to their default zero values.

**Preconditions**: Validator running with `--reset` (clean slate).

**Steps**:
1. Call `program.methods.initialize().rpc()`
2. Fetch the vault account: `program.account.vault.fetch(vaultPda)`
3. Assert each field equals zero

**Pseudo code**:
```ts
await program.methods.initialize().rpc()

vault = await program.account.vault.fetch(vaultPda)
assert vault.btcAmount  == BN(0)
assert vault.ethAmount  == BN(0)
assert vault.solAmount  == BN(0)
assert vault.usdcAmount == BN(0)
```

**Pass criteria**:
- `btcAmount`  = 0
- `ethAmount`  = 0
- `solAmount`  = 0
- `usdcAmount` = 0

---

## Test Case 2: swap_wsol_to_usdc — SOL Wraps and Swaps Through USDC Whirlpool

**What is tested**: `swap_wsol_to_usdc` wraps native SOL into wSOL (via system
transfer + `sync_native`), then performs an Orca Whirlpool CPI to swap wSOL → USDC.
The `vault.usdc_amount` field reflects the resulting USDC balance.

**Preconditions**:
- Vault PDA exists (initialize if missing)
- Validator running with cloned WSOL/USDC pool accounts and Whirlpool `.so`
- Admin wallet has enough lamports to cover the swap amount + fees

**Steps**:
1. Initialize vault if it does not yet exist
2. Derive all accounts from shared setup (pool parse, tick arrays, oracle)
3. Call `program.methods.swapWsolToUsdc(solAmountIn, minUsdcOut=0, aToB)`
4. Fetch updated vault; assert `usdcAmount > 0`

**Pseudo code**:
```ts
if (!vaultExists) await program.methods.initialize().rpc()

const SOL_AMOUNT = 0.01 * LAMPORTS_PER_SOL

await program.methods
  .swapWsolToUsdc(new BN(SOL_AMOUNT), new BN(0), aToB)
  .accounts({
    vault: vaultPda,
    vaultAuthority,
    vaultWsolAta,
    wsolMint: WSOL_MINT,
    vaultUsdcAta,
    usdcMint,
    whirlpoolProgram: WHIRLPOOL_PROGRAM_ID,
    usdcWhirlpool: WSOL_USDC_POOL,
    usdcTokenOwnerA: tokenOwnerA,
    usdcVaultA: usdcPool.data.tokenVaultA,
    usdcTokenOwnerB: tokenOwnerB,
    usdcVaultB: usdcPool.data.tokenVaultB,
    usdcTickArray0: tickArray0,
    usdcTickArray1: tickArray1,
    usdcTickArray2: tickArray2,
    usdcOracle: oracle,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  })
  .rpc()

vault = await program.account.vault.fetch(vaultPda)
assert vault.usdcAmount > 0
```

**Pass criteria**:
- Transaction confirms without error
- `vault.usdcAmount` > 0 (USDC received from swap)

---

## Test Case 3: distribute_all — Vault Tokens Transferred to Admin ATAs

**What is tested**: `distribute_all` transfers all vault token balances (USDC, WBTC,
WETH) to the corresponding admin ATAs. After the call, vault amounts reset to zero.

**Preconditions**:
- Vault has non-zero `usdc_amount` (run Test Case 2 first)
- Vault ATAs for WBTC and WETH must exist (even if balance = 0)
- Admin ATAs for USDC, WBTC, and WETH must exist

**Steps**:
1. Assert `vault.usdcAmount > 0` (precondition check)
2. Create vault ATAs for WBTC and WETH idempotently (owned by `vaultAuthority`)
3. Create admin ATAs for USDC, WBTC, and WETH idempotently (owned by `signer`)
4. Record `vault.usdcAmount` before the call
5. Call `program.methods.distributeAll()`
6. Fetch updated vault; assert `usdcAmount = 0`
7. Assert admin USDC ATA received exactly `preDistributeUsdcAmount` tokens

**Pseudo code**:
```ts
vault = await program.account.vault.fetch(vaultPda)
assert vault.usdcAmount > 0, "run Test Case 2 first"

// Pre-create all required ATAs (idempotent — safe to call on repeated runs)
vaultUsdcAta = createAtaIdempotent(payer, vaultAuthority, USDC_MINT)
vaultWbtcAta = createAtaIdempotent(payer, vaultAuthority, WBTC_MINT)
vaultWethAta = createAtaIdempotent(payer, vaultAuthority, WETH_MINT)
adminUsdcAta = createAtaIdempotent(payer, signer, USDC_MINT)
adminWbtcAta = createAtaIdempotent(payer, signer, WBTC_MINT)
adminWethAta = createAtaIdempotent(payer, signer, WETH_MINT)

usdcBefore = vault.usdcAmount.toNumber()

await program.methods.distributeAll()
  .accounts({
    vault: vaultPda,
    vaultAuthority,
    usdcMint: USDC_MINT,
    vaultUsdcAta,
    adminUsdcAta,
    wbtcMint: WBTC_MINT,
    vaultWbtcAta,
    adminWbtcAta,
    wethMint: WETH_MINT,
    vaultWethAta,
    adminWethAta,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc()

vaultAfter = await program.account.vault.fetch(vaultPda)
assert vaultAfter.usdcAmount == 0

adminUsdcBalance = await connection.getTokenAccountBalance(adminUsdcAta)
assert adminUsdcBalance.value.amount == usdcBefore.toString()
```

**Pass criteria**:
- Transaction confirms without error
- `vault.usdcAmount` = 0 after distribute
- Admin USDC ATA balance = pre-distribute vault USDC amount
- `vault.btcAmount` and `vault.ethAmount` remain 0 (nothing to distribute)
