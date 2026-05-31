import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID as SPL_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, Connection, Transaction } from "@solana/web3.js";
import { OrcaSwap } from "../target/types/orca_swap";
import { assert } from "chai";

// ─── Constants ────────────────────────────────────────────────────────────────

const VAULT_SEED = Buffer.from("vault");
const VAULT_AUTHORITY_SEED = Buffer.from("vault_authority");
const WHIRLPOOL_PROGRAM_ID = new PublicKey(
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
);
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bJ4",
);

// Orca SOL/WBTC and SOL/WETH whirlpool addresses (mainnet)
const WSOL_WBTC_POOL = new PublicKey(
  "B5EwJVDuAauzUEEdwvbuXzbFFgEYnUqqS37TUM1c4PQA",
);
const WSOL_WETH_POOL = new PublicKey(
  "HktfL7iwGKT5QHjywQkcDnZXScoh811k7akrMZJkCcEF",
);

const TICK_ARRAY_SIZE = 88;

// ─── Surfpool cheatcode helpers ───────────────────────────────────────────────

/** Send a raw surfnet_* JSON-RPC call to the local validator. */
async function surfnetRpc(
  connection: Connection,
  method: string,
  params: unknown[],
): Promise<unknown> {
  // @ts-ignore — _rpcRequest is not in the public Connection type
  const result = await (connection as any)._rpcRequest(method, params);
  if (result.error) {
    throw new Error(`${method} failed: ${JSON.stringify(result.error)}`);
  }
  return result.result;
}

/** Reset an account to its remote (mainnet) state, wiping any local mutations. */
async function surfnetResetAccount(
  connection: Connection,
  pubkey: PublicKey,
): Promise<void> {
  await surfnetRpc(connection, "surfnet_resetAccount", [
    pubkey.toBase58(),
    { includeOwnedAccounts: false },
  ]);
}

/**
 * Stream an account from mainnet so Surfpool fetches it live on every access.
 * Also optionally streams all accounts it owns.
 */
async function surfnetStreamAccount(
  connection: Connection,
  pubkey: PublicKey,
  includeOwnedAccounts = false,
): Promise<void> {
  await surfnetRpc(connection, "surfnet_streamAccount", [
    pubkey.toBase58(),
    { includeOwnedAccounts },
  ]);
}

async function surfnetWipeAccount(
  connection: Connection,
  pubkey: PublicKey,
): Promise<void> {
  await surfnetRpc(connection, "surfnet_setAccount", [
    pubkey.toBase58(),
    {
      lamports: 0,
      data: "",
      owner: "11111111111111111111111111111111",
      executable: false,
    },
  ]);
}

/** Remove stale non-ATA accounts left by surfnet_setTokenAccount. */
async function surfnetCleanupNonCanonicalTokenAccounts(
  connection: Connection,
  owner: PublicKey,
  canonicalAtas: PublicKey[],
): Promise<void> {
  const canonical = new Set(canonicalAtas.map((a) => a.toBase58()));
  const existing = await connection.getTokenAccountsByOwner(owner, {
    programId: TOKEN_PROGRAM_ID,
  });
  for (const { pubkey } of existing.value) {
    if (!canonical.has(pubkey.toBase58())) {
      await surfnetWipeAccount(connection, pubkey);
    }
  }
}

/** Create a vault-authority ATA via the Associated Token Program (idempotent). */
async function ensureVaultAta(
  provider: anchor.AnchorProvider,
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
): Promise<PublicKey> {
  const ata = findAta(owner, mint);
  if (!(await provider.connection.getAccountInfo(ata))) {
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        payer,
        ata,
        owner,
        mint,
        SPL_TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
    await provider.sendAndConfirm(tx);
  }
  return ata;
}

// ─── Whirlpool account parsing ────────────────────────────────────────────────

interface WhirlpoolInfo {
  tokenMintA: PublicKey;
  tokenVaultA: PublicKey;
  tokenMintB: PublicKey;
  tokenVaultB: PublicKey;
  tickSpacing: number;
  tickCurrentIndex: number;
}

function parseWhirlpool(data: Buffer): WhirlpoolInfo {
  return {
    tokenMintA: new PublicKey(data.subarray(101, 133)),
    tokenVaultA: new PublicKey(data.subarray(133, 165)),
    tokenMintB: new PublicKey(data.subarray(181, 213)),
    tokenVaultB: new PublicKey(data.subarray(213, 245)),
    tickSpacing: data.readUInt16LE(41),
    tickCurrentIndex: data.readInt32LE(81),
  };
}

function tickArrayStartIndex(tickIndex: number, tickSpacing: number): number {
  const ticksPerArray = TICK_ARRAY_SIZE * Math.max(tickSpacing, 1);
  return Math.floor(tickIndex / ticksPerArray) * ticksPerArray;
}

function findTickArrayPda(
  whirlpool: PublicKey,
  startTickIndex: number,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("tick_array"),
      whirlpool.toBuffer(),
      Buffer.from(String(startTickIndex)),
    ],
    WHIRLPOOL_PROGRAM_ID,
  );
  return pda;
}

function findOraclePda(whirlpool: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), whirlpool.toBuffer()],
    WHIRLPOOL_PROGRAM_ID,
  );
  return pda;
}

function findAta(owner: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    true,
    SPL_TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

interface PoolAccounts {
  pool: PublicKey;
  info: WhirlpoolInfo;
  tickArray0: PublicKey;
  tickArray1: PublicKey;
  tickArray2: PublicKey;
  oracle: PublicKey;
}

/**
 * Stream the whirlpool + its vaults/mints from mainnet, then derive tick
 * arrays and oracle from the on-chain state.
 */
async function streamPool(
  connection: Connection,
  poolAddress: PublicKey,
): Promise<PoolAccounts> {
  // Stream the pool itself so Surfpool fetches it from mainnet
  await surfnetStreamAccount(connection, poolAddress);

  const raw = await connection.getAccountInfo(poolAddress);
  if (!raw) throw new Error(`Pool not found: ${poolAddress.toBase58()}`);
  const info = parseWhirlpool(Buffer.from(raw.data));

  // Stream mints + vaults from mainnet
  await surfnetStreamAccount(connection, info.tokenMintA);
  await surfnetStreamAccount(connection, info.tokenMintB);
  await surfnetStreamAccount(connection, info.tokenVaultA);
  await surfnetStreamAccount(connection, info.tokenVaultB);

  const ticksPerArray = TICK_ARRAY_SIZE * info.tickSpacing;
  const start0 = tickArrayStartIndex(info.tickCurrentIndex, info.tickSpacing);
  const start1 = start0 - ticksPerArray;
  const start2 = start0 + ticksPerArray;

  const ta0 = findTickArrayPda(poolAddress, start0);
  const ta1 = findTickArrayPda(poolAddress, start1);
  const ta2 = findTickArrayPda(poolAddress, start2);

  // Stream tick arrays (they live on mainnet)
  for (const ta of [ta0, ta1, ta2]) {
    await surfnetStreamAccount(connection, ta);
  }

  const oracle = findOraclePda(poolAddress);
  // Oracle is optional — SOL/WBTC and SOL/WETH pools use uninitialized oracle PDAs.

  return {
    pool: poolAddress,
    info,
    tickArray0: ta0,
    tickArray1: ta1,
    tickArray2: ta2,
    oracle,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("orca_swap", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.orcaSwap as Program<OrcaSwap>;
  const provider = anchor.AnchorProvider.env();
  const connection = provider.connection;
  const signer = provider.wallet.publicKey;

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [VAULT_SEED, signer.toBytes()],
    program.programId,
  );
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [VAULT_AUTHORITY_SEED],
    program.programId,
  );

  it("initialize: creates the Vault account and all amounts default to zero", async () => {
    // Reset vault in case it was already created by a previous run
    try {
      await surfnetResetAccount(connection, vaultPda);
    } catch (_) {
      // Account didn't exist remotely — ignore
    }

    await program.methods.initialize().rpc();

    const vault = await program.account.vault.fetch(vaultPda);
    console.log("Vault state after initialize:");
    console.log("  btc_amount :", vault.btcAmount.toString());
    console.log("  eth_amount :", vault.ethAmount.toString());
    console.log("  sol_amount :", vault.solAmount.toString());

    assert.equal(vault.btcAmount.toString(), "0");
    assert.equal(vault.ethAmount.toString(), "0");
    assert.equal(vault.solAmount.toString(), "0");
  });

  it("swap_sol_to_assets: streams mainnet Whirlpool accounts and swaps SOL → WBTC + WETH", async () => {
    // ── 1. Ensure vault exists ────────────────────────────────────────────────
    const vaultInfo = await connection.getAccountInfo(vaultPda);
    if (!vaultInfo) {
      await program.methods.initialize().rpc();
    }

    // ── 2. Stream both pools + their dependencies from mainnet via Surfpool ───
    console.log("Streaming WBTC pool accounts from mainnet…");
    const wbtcPool = await streamPool(connection, WSOL_WBTC_POOL);
    console.log(
      `  WBTC pool: mintA=${wbtcPool.info.tokenMintA.toBase58()} mintB=${wbtcPool.info.tokenMintB.toBase58()}`,
    );

    console.log("Streaming WETH pool accounts from mainnet…");
    const wethPool = await streamPool(connection, WSOL_WETH_POOL);
    console.log(
      `  WETH pool: mintA=${wethPool.info.tokenMintA.toBase58()} mintB=${wethPool.info.tokenMintB.toBase58()}`,
    );

    // ── 3. Determine which side is WSOL for each pool ─────────────────────────
    // For the WSOL/WBTC pool: WSOL is token A, WBTC is token B
    // a_to_b = true means we are swapping token A (WSOL) for token B (WBTC)
    const wbtcAtoB = wbtcPool.info.tokenMintA.equals(WSOL_MINT);
    const wethAtoB = wethPool.info.tokenMintA.equals(WSOL_MINT);

    const wbtcMint = wbtcAtoB
      ? wbtcPool.info.tokenMintB
      : wbtcPool.info.tokenMintA;
    const wethMint = wethAtoB
      ? wethPool.info.tokenMintB
      : wethPool.info.tokenMintA;

    console.log(`  WBTC mint: ${wbtcMint.toBase58()}, a_to_b=${wbtcAtoB}`);
    console.log(`  WETH mint: ${wethMint.toBase58()}, a_to_b=${wethAtoB}`);

    // ── 4. Derive vault authority ATAs ────────────────────────────────────────
    const vaultWsolAta = findAta(vaultAuthority, WSOL_MINT);
    const vaultWbtcAta = findAta(vaultAuthority, wbtcMint);
    const vaultWethAta = findAta(vaultAuthority, wethMint);

    // ── 5. Ensure canonical vault ATAs exist; program wraps SOL into WSOL ATA ───
    const SOL_AMOUNT = 0.01 * 1e9;
    const WBTC_AMOUNT_IN = Math.floor(SOL_AMOUNT * 0.5);
    const WETH_AMOUNT_IN = Math.floor(SOL_AMOUNT * 0.5);

    await surfnetCleanupNonCanonicalTokenAccounts(connection, vaultAuthority, [
      vaultWsolAta,
      vaultWbtcAta,
      vaultWethAta,
    ]);

    // Output ATAs must exist before the instruction (Anchor Account<TokenAccount>).
    await ensureVaultAta(provider, signer, vaultAuthority, wbtcMint);
    await ensureVaultAta(provider, signer, vaultAuthority, wethMint);
    // WSOL ATA is created idempotently inside swap_sol_to_assets.

    // These pools have no on-chain oracle; clear any streamed/cheated oracle account.
    for (const oracle of [wbtcPool.oracle, wethPool.oracle]) {
      const info = await connection.getAccountInfo(oracle);
      if (info && info.data.length > 0) {
        await surfnetWipeAccount(connection, oracle);
      }
    }

    const wbtcTokenOwnerA = wbtcAtoB ? vaultWsolAta : vaultWbtcAta;
    const wbtcTokenOwnerB = wbtcAtoB ? vaultWbtcAta : vaultWsolAta;
    const wethTokenOwnerA = wethAtoB ? vaultWsolAta : vaultWethAta;
    const wethTokenOwnerB = wethAtoB ? vaultWethAta : vaultWsolAta;

    // ── 7. Call swap_sol_to_assets ────────────────────────────────────────────
    const tx = await program.methods
      .swapSolToAssets(
        new anchor.BN(SOL_AMOUNT),
        new anchor.BN(WBTC_AMOUNT_IN),
        new anchor.BN(0), // wbtc_min_out (no slippage guard for test)
        wbtcAtoB,
        new anchor.BN(WETH_AMOUNT_IN),
        new anchor.BN(0), // weth_min_out
        wethAtoB,
      )
      .accounts({
        vault: vaultPda,
        vaultWsolAta,
        wsolMint: WSOL_MINT,
        vaultWbtcAta,
        vaultWethAta,
        wbtcWhirlpool: wbtcPool.pool,
        wbtcTokenOwnerA,
        wbtcVaultA: wbtcPool.info.tokenVaultA,
        wbtcTokenOwnerB,
        wbtcVaultB: wbtcPool.info.tokenVaultB,
        wbtcTickArray0: wbtcPool.tickArray0,
        wbtcTickArray1: wbtcPool.tickArray1,
        wbtcTickArray2: wbtcPool.tickArray2,
        wbtcOracle: wbtcPool.oracle,
        wethWhirlpool: wethPool.pool,
        wethTokenOwnerA,
        wethVaultA: wethPool.info.tokenVaultA,
        wethTokenOwnerB,
        wethVaultB: wethPool.info.tokenVaultB,
        wethTickArray0: wethPool.tickArray0,
        wethTickArray1: wethPool.tickArray1,
        wethTickArray2: wethPool.tickArray2,
        wethOracle: wethPool.oracle,
      } as any)
      .rpc();

    console.log("swap_sol_to_assets tx:", tx);

    // ── 8. Verify vault balances updated ─────────────────────────────────────
    const vault = await program.account.vault.fetch(vaultPda);
    console.log("Vault state after swap:");
    console.log("  btc_amount :", vault.btcAmount.toString());
    console.log("  eth_amount :", vault.ethAmount.toString());
    console.log("  sol_amount :", vault.solAmount.toString());

    assert.isTrue(
      vault.btcAmount.toNumber() > 0,
      "btc_amount should be > 0 after swap",
    );
    assert.isTrue(
      vault.ethAmount.toNumber() > 0,
      "eth_amount should be > 0 after swap",
    );
  });
});
