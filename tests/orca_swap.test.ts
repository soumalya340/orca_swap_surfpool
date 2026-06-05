import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { OrcaSwap } from "../target/types/orca_swap";
import orcaSwapIdl from "../target/idl/orca_swap.json";
import { assert } from "chai";
import {
  WHIRLPOOL_PROGRAM_ID,
  parseWhirlpool,
  findOraclePda,
  deriveTickArrays,
  findAta,
  ensureAta,
  surfnetWipeAccount,
  program_status,
  logCu,
  surfnetSetTokenBalance,
  createAndExtendLut,
} from "./utils/helpers";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getMint,
} from "@solana/spl-token";
import {
  VAULT_SEED,
  VAULT_AUTHORITY_SEED,
  WSOL_MINT,
  WSOL_WBTC_POOL,
  WSOL_WETH_POOL,
  USDC_MINT,
  WSOL_USDC_POOL,
  ORCA_SWAP_PROGRAM_ID,
} from "./utils/constants";

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const program = new Program(
  { ...orcaSwapIdl, address: ORCA_SWAP_PROGRAM_ID.toBase58() },
  provider,
) as Program<OrcaSwap>;
const connection = provider.connection;
const signer = provider.wallet.publicKey;
let lookupTableAddress: PublicKey;

type VaultTokenBalances = {
  usdc: { uiAmount: number | null; amount: string };
  wsol: { uiAmount: number | null; amount: string };
  wbtc: { uiAmount: number | null; amount: string };
  weth: { uiAmount: number | null; amount: string };
};

async function getVaultTokenBalances(atas: {
  usdc: PublicKey;
  wsol: PublicKey;
  wbtc: PublicKey;
  weth: PublicKey;
}): Promise<VaultTokenBalances> {
  const fetchBalance = async (ata: PublicKey) => {
    try {
      const balance = await connection.getTokenAccountBalance(ata);
      return balance.value;
    } catch {
      return { uiAmount: 0, amount: "0", decimals: 0 };
    }
  };

  const [usdc, wsol, wbtc, weth] = await Promise.all([
    fetchBalance(atas.usdc),
    fetchBalance(atas.wsol),
    fetchBalance(atas.wbtc),
    fetchBalance(atas.weth),
  ]);

  return { usdc, wsol, wbtc, weth };
}

function logVaultTokenBalances(
  label: string,
  balances: VaultTokenBalances,
): void {
  console.log(`  Vault token balances ${label}:`);
  console.log(
    `    USDC: ${balances.usdc.uiAmount ?? 0} (raw: ${balances.usdc.amount})`,
  );
  console.log(
    `    wSOL: ${balances.wsol.uiAmount ?? 0} (raw: ${balances.wsol.amount})`,
  );
  console.log(
    `    WBTC: ${balances.wbtc.uiAmount ?? 0} (raw: ${balances.wbtc.amount})`,
  );
  console.log(
    `    WETH: ${balances.weth.uiAmount ?? 0} (raw: ${balances.weth.amount})`,
  );
}

// ─── Shared provider / program ────────────────────────────────────────────────

const [vaultPda] = PublicKey.findProgramAddressSync(
  [VAULT_SEED, signer.toBytes()],
  program.programId,
);

const [vaultAuthority] = PublicKey.findProgramAddressSync(
  [VAULT_AUTHORITY_SEED],
  program.programId,
);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("orca_swap", () => {
  before(async () => {
    await program_status(connection, program.programId, "OrcaSwap");
    await program_status(connection, WHIRLPOOL_PROGRAM_ID, "Whirlpool Program");

    const wbtcPoolInfo = await program_status(
      connection,
      WSOL_WBTC_POOL,
      "WSOL/WBTC Pool",
    );
    const wethPoolInfo = await program_status(
      connection,
      WSOL_WETH_POOL,
      "WSOL/WETH Pool",
    );

    // 5. Parse pools and verify vaults exist
    const wbtcInfo = parseWhirlpool(Buffer.from(wbtcPoolInfo.data));
    const wethInfo = parseWhirlpool(Buffer.from(wethPoolInfo.data));

    const vaults = [
      wbtcInfo.tokenVaultA,
      wbtcInfo.tokenVaultB,
      wethInfo.tokenVaultA,
      wethInfo.tokenVaultB,
    ];

    for (const vault of vaults) {
      await program_status(
        connection,
        vault,
        "Pool Token Vault",
        "Check your validator clones",
      );
    }

    // 6. Verify required Tick Arrays exist
    const [wbtcTa0] = deriveTickArrays(
      WSOL_WBTC_POOL,
      wbtcInfo.tickCurrentIndex,
      wbtcInfo.tickSpacing,
    );
    const [wethTa0] = deriveTickArrays(
      WSOL_WETH_POOL,
      wethInfo.tickCurrentIndex,
      wethInfo.tickSpacing,
    );

    await program_status(connection, wbtcTa0, "WBTC Pool Tick Array");
    await program_status(connection, wethTa0, "WETH Pool Tick Array");

    // 7. Auto-align clock if validator is lagging behind Mainnet pools
    const slot = await connection.getSlot();
    const blockTime = await connection.getBlockTime(slot);
    const maxPoolTimestamp = anchor.BN.max(
      wbtcInfo.rewardLastUpdatedTimestamp,
      wethInfo.rewardLastUpdatedTimestamp,
    );

    if (blockTime && new anchor.BN(blockTime).lt(maxPoolTimestamp)) {
      const deltaSec = maxPoolTimestamp.toNumber() - blockTime + 3600; // Sync + 1 hour safety margin
      const deltaSlots = Math.ceil(deltaSec / 0.4); // 400ms per slot
      const targetSlot = slot + deltaSlots;

      console.log(`  ⏰ Validator clock is behind Mainnet pool state.`);
      console.log(
        `  ⏰ Auto-advancing validator slot by ${deltaSlots} slots to target slot ${targetSlot}...`,
      );

      try {
        // @ts-ignore
        const result = await (connection as any)._rpcRequest(
          "surfnet_timeTravel",
          [{ absoluteSlot: targetSlot }],
        );
        if (result.error) throw new Error(JSON.stringify(result.error));
        console.log("  ✅ Time-travel successful!");
      } catch (err: any) {
        console.warn(
          "  ⚠️ Time-travel failed (can be ignored on standard solana-test-validator):",
          err.message || err,
        );
      }
    }
  });

  it("initialize: vault PDA is created and all amounts default to zero", async () => {
    console.log("\n Test 1 \n");

    const existingVaultInfo = await connection.getAccountInfo(vaultPda);
    const wasAlreadyInitialized = existingVaultInfo !== null;

    const tx = await program.methods
      .initialize()
      .accounts({
        signer,
        vault: vaultPda,
        vaultAuthority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`The initialize tx : ${tx}`);
    await logCu(connection, tx, "initialize");

    const vault = await program.account.vault.fetch(vaultPda);

    if (!wasAlreadyInitialized) {
      assert.equal(vault.btcAmount.toString(), "0");
      assert.equal(vault.ethAmount.toString(), "0");
      assert.equal(vault.solAmount.toString(), "0");
      assert.equal(vault.usdcAmount.toString(), "0");
    } else {
      console.log(
        "  ⚠️ Vault already existed before initialize — skipping zero-amount assertions",
      );
    }
  });

  it("swap_sol_to_assets: SOL wraps and swaps to WBTC + WETH, vault amounts both > 0", async () => {
    console.log("\n Test 2 \n");
    const wbtcPoolInfo = await program_status(
      connection,
      WSOL_WBTC_POOL,
      "WSOL/WBTC Pool",
    );
    const wbtcInfo = parseWhirlpool(Buffer.from(wbtcPoolInfo.data));

    const wethPoolInfo = await program_status(
      connection,
      WSOL_WETH_POOL,
      "WSOL/WETH Pool",
    );
    const wethInfo = parseWhirlpool(Buffer.from(wethPoolInfo.data));

    // Determine swap direction: a_to_b = true when WSOL is token A
    const wbtcAtoB = wbtcInfo.tokenMintA.equals(WSOL_MINT);
    const wethAtoB = wethInfo.tokenMintA.equals(WSOL_MINT);

    const wbtcMint = wbtcAtoB ? wbtcInfo.tokenMintB : wbtcInfo.tokenMintA;
    const wethMint = wethAtoB ? wethInfo.tokenMintB : wethInfo.tokenMintA;

    // Derive vault ATAs
    const vaultWsolAta = findAta(vaultAuthority, WSOL_MINT);
    const vaultWbtcAta = findAta(vaultAuthority, wbtcMint);
    const vaultWethAta = findAta(vaultAuthority, wethMint);

    // vault_wbtc_ata and vault_weth_ata are Account<TokenAccount> in the program —
    // they must exist before the instruction is called.
    await ensureAta(provider, vaultAuthority, wbtcMint);
    await ensureAta(provider, vaultAuthority, wethMint);

    // Derive tick arrays for each pool
    const [wbtcTa0, wbtcTa1, wbtcTa2] = deriveTickArrays(
      WSOL_WBTC_POOL,
      wbtcInfo.tickCurrentIndex,
      wbtcInfo.tickSpacing,
    );
    const [wethTa0, wethTa1, wethTa2] = deriveTickArrays(
      WSOL_WETH_POOL,
      wethInfo.tickCurrentIndex,
      wethInfo.tickSpacing,
    );

    const wbtcOracle = findOraclePda(WSOL_WBTC_POOL);
    const wethOracle = findOraclePda(WSOL_WETH_POOL);

    // Wipe oracle accounts right before the swap to prevent Surfpool JIT dependency resolution from overwriting them
    await surfnetWipeAccount(connection, wbtcOracle);
    await surfnetWipeAccount(connection, wethOracle);
    console.log("  🧹 Wiped oracle accounts right before swap");

    // Token owner accounts flip depending on a_to_b direction
    const wbtcTokenOwnerA = wbtcAtoB ? vaultWsolAta : vaultWbtcAta;
    const wbtcTokenOwnerB = wbtcAtoB ? vaultWbtcAta : vaultWsolAta;
    const wethTokenOwnerA = wethAtoB ? vaultWsolAta : vaultWethAta;
    const wethTokenOwnerB = wethAtoB ? vaultWethAta : vaultWsolAta;

    const SOL_AMOUNT_TO_SWAP = 0.01 * LAMPORTS_PER_SOL;
    const WBTC_AMOUNT_IN = Math.floor(SOL_AMOUNT_TO_SWAP * 0.5);
    const WETH_AMOUNT_IN = Math.floor(SOL_AMOUNT_TO_SWAP * 0.5);

    const tx = await program.methods
      .swapSolToAssets(
        new anchor.BN(SOL_AMOUNT_TO_SWAP),
        new anchor.BN(WBTC_AMOUNT_IN),
        new anchor.BN(0),
        wbtcAtoB,
        new anchor.BN(WETH_AMOUNT_IN),
        new anchor.BN(0),
        wethAtoB,
      )
      .accounts({
        signer,
        vault: vaultPda,
        vaultAuthority,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        vaultWsolAta,
        wsolMint: WSOL_MINT,
        vaultWbtcAta,
        vaultWethAta,
        whirlpoolProgram: WHIRLPOOL_PROGRAM_ID,
        wbtcWhirlpool: WSOL_WBTC_POOL,
        wbtcTokenOwnerA,
        wbtcVaultA: wbtcInfo.tokenVaultA,
        wbtcTokenOwnerB,
        wbtcVaultB: wbtcInfo.tokenVaultB,
        wbtcTickArray0: wbtcTa0,
        wbtcTickArray1: wbtcTa1,
        wbtcTickArray2: wbtcTa2,
        wbtcOracle,
        wethWhirlpool: WSOL_WETH_POOL,
        wethTokenOwnerA,
        wethVaultA: wethInfo.tokenVaultA,
        wethTokenOwnerB,
        wethVaultB: wethInfo.tokenVaultB,
        wethTickArray0: wethTa0,
        wethTickArray1: wethTa1,
        wethTickArray2: wethTa2,
        wethOracle,
      } as any)
      .rpc();

    console.log(`The swap tx : ${tx}`);
    await logCu(connection, tx, "swap_sol_to_assets");

    const vault = await program.account.vault.fetch(vaultPda);

    const wbtcMintInfo = await getMint(
      connection,
      wbtcMint,
      "confirmed",
      TOKEN_PROGRAM_ID,
    );
    const wbtcDecimals = wbtcMintInfo.decimals;
    const wbtcHuman = vault.btcAmount.toNumber() / 10 ** wbtcDecimals;

    const wethMintInfo = await getMint(
      connection,
      wethMint,
      "confirmed",
      TOKEN_PROGRAM_ID,
    );
    const wethDecimals = wethMintInfo.decimals;
    const wethHuman = vault.ethAmount.toNumber() / 10 ** wethDecimals;

    console.log("The token balances are : ");

    console.log(`The BTC amount is : ${wbtcHuman}`);
    console.log(`The ETH amount is : ${wethHuman} `);

    const vaultWbtcBalance = await connection.getTokenAccountBalance(
      vaultWbtcAta,
    );
    const vaultWethBalance = await connection.getTokenAccountBalance(
      vaultWethAta,
    );

    console.log(
      `The BTC Vault ATA balance is : ${vaultWbtcBalance.value.uiAmount} (raw: ${vaultWbtcBalance.value.amount})`,
    );
    console.log(
      `The ETH Vault ATA balance is : ${vaultWethBalance.value.uiAmount} (raw: ${vaultWethBalance.value.amount})`,
    );

    assert.isTrue(
      vault.btcAmount.toNumber() > 0,
      "btcAmount should be > 0 after swap",
    );
    assert.isTrue(
      vault.ethAmount.toNumber() > 0,
      "ethAmount should be > 0 after swap",
    );
  });

  it("swap_wsol_to_usdc: vault usdcAmount increases after swapping SOL → USDC", async () => {
    console.log("\n Test 3 \n");

    const usdcPoolInfo = await program_status(
      connection,
      WSOL_USDC_POOL,
      "WSOL/USDC Pool",
    );
    const usdcInfo = parseWhirlpool(Buffer.from(usdcPoolInfo.data));

    // a_to_b = true when WSOL is token A in the pool
    const aToB = usdcInfo.tokenMintA.equals(WSOL_MINT);

    const vaultWsolAta = findAta(vaultAuthority, WSOL_MINT);
    const vaultUsdcAta = findAta(vaultAuthority, USDC_MINT);

    await ensureAta(provider, vaultAuthority, USDC_MINT);

    // Track vault's USDC ATA balance before the swap
    const vaultUsdcBalanceBefore = await connection.getTokenAccountBalance(
      vaultUsdcAta,
    );
    console.log(
      `  Vault USDC Balance before: ${vaultUsdcBalanceBefore.value.uiAmount} (raw: ${vaultUsdcBalanceBefore.value.amount})`,
    );

    const [usdcTa0, usdcTa1, usdcTa2] = deriveTickArrays(
      WSOL_USDC_POOL,
      usdcInfo.tickCurrentIndex,
      usdcInfo.tickSpacing,
    );

    const usdcOracle = findOraclePda(WSOL_USDC_POOL);
    await surfnetWipeAccount(connection, usdcOracle);
    console.log("  🧹 Wiped USDC oracle account before swap");

    const usdcTokenOwnerA = aToB ? vaultWsolAta : vaultUsdcAta;
    const usdcTokenOwnerB = aToB ? vaultUsdcAta : vaultWsolAta;

    const SOL_AMOUNT_IN = 1 * LAMPORTS_PER_SOL;
    const usdcBefore = (await program.account.vault.fetch(vaultPda)).usdcAmount;

    const tx = await program.methods
      .swapWsolToUsdc(new anchor.BN(SOL_AMOUNT_IN), new anchor.BN(0), aToB)
      .accounts({
        signer,
        vault: vaultPda,
        vaultAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        vaultWsolAta,
        wsolMint: WSOL_MINT,
        vaultUsdcAta,
        usdcMint: USDC_MINT,
        whirlpoolProgram: WHIRLPOOL_PROGRAM_ID,
        usdcWhirlpool: WSOL_USDC_POOL,
        usdcTokenOwnerA,
        usdcVaultA: usdcInfo.tokenVaultA,
        usdcTokenOwnerB,
        usdcVaultB: usdcInfo.tokenVaultB,
        usdcTickArray0: usdcTa0,
        usdcTickArray1: usdcTa1,
        usdcTickArray2: usdcTa2,
        usdcOracle,
      } as any)
      .rpc();

    console.log(`  swap_wsol_to_usdc tx: ${tx}`);
    await logCu(connection, tx, "swap_wsol_to_usdc");

    const vault = await program.account.vault.fetch(vaultPda);

    const usdcMintInfo = await getMint(
      connection,
      USDC_MINT,
      "confirmed",
      TOKEN_PROGRAM_ID,
    );

    const usdcDecimals = usdcMintInfo.decimals;
    const usdcHuman = vault.usdcAmount.toNumber() / 10 ** usdcDecimals;

    console.log("The token balances are : ");

    console.log(`The USDC amount in vault is : ${usdcHuman}`);

    const vaultUsdcBalanceAfter = await connection.getTokenAccountBalance(
      vaultUsdcAta,
    );

    const usdcReceivedRaw =
      BigInt(vaultUsdcBalanceAfter.value.amount) -
      BigInt(vaultUsdcBalanceBefore.value.amount);
    const usdcReceivedHuman =
      Number(usdcReceivedRaw) / 10 ** usdcMintInfo.decimals;
    const solSwapped = SOL_AMOUNT_IN / LAMPORTS_PER_SOL;

    console.log(
      `  Vault USDC before: ${vaultUsdcBalanceBefore.value.uiAmount} USDC`,
    );
    console.log(
      `  Vault USDC after:  ${vaultUsdcBalanceAfter.value.uiAmount} USDC`,
    );
    console.log(
      `  USDC received for ${solSwapped} SOL: ${usdcReceivedHuman} USDC`,
    );
    console.log(
      `  Effective rate: 1 SOL = ${(usdcReceivedHuman / solSwapped).toFixed(
        4,
      )} USDC`,
    );

    assert.isTrue(
      usdcReceivedRaw > 0n,
      "vault USDC ATA balance should increase after swap",
    );

    assert.isTrue(
      vault.usdcAmount.toNumber() > usdcBefore.toNumber(),
      "usdcAmount should increase after swap",
    );
    assert.isTrue(
      vault.usdcAmount.toNumber() > 0,
      "usdcAmount should be > 0 after swap",
    );
  });

  it("swap_usdc_to_assets: vault swaps USDC → SOL → WBTC & WETH", async () => {
    console.log("\n Test 4 \n");

    const signerUsdcAta = await ensureAta(provider, signer, USDC_MINT);

    // 1. JIT-fund signer's USDC ATA with 500 USDC
    const USDC_AMOUNT_IN = 500_000_000; // 500 USDC (6 decimals)
    await surfnetSetTokenBalance(
      connection,
      signerUsdcAta,
      USDC_MINT,
      signer,
      USDC_AMOUNT_IN,
    );
    console.log("  ✅ Signer USDC ATA funded with 500 USDC via Surfnet RPC");

    // 2. Fetch pool info & tick arrays
    const usdcPoolInfo = await program_status(
      connection,
      WSOL_USDC_POOL,
      "WSOL/USDC Pool",
    );
    const usdcInfo = parseWhirlpool(Buffer.from(usdcPoolInfo.data));
    const usdcAtoB = usdcInfo.tokenMintA.equals(USDC_MINT); // false since WSOL is token A
    const [usdcTa0, usdcTa1, usdcTa2] = deriveTickArrays(
      WSOL_USDC_POOL,
      usdcInfo.tickCurrentIndex,
      usdcInfo.tickSpacing,
    );
    const usdcOracle = findOraclePda(WSOL_USDC_POOL);

    const wbtcPoolInfo = await program_status(
      connection,
      WSOL_WBTC_POOL,
      "WSOL/WBTC Pool",
    );
    const wbtcInfo = parseWhirlpool(Buffer.from(wbtcPoolInfo.data));
    const wbtcAtoB = wbtcInfo.tokenMintA.equals(WSOL_MINT); // true since WSOL is token A
    const [wbtcTa0, wbtcTa1, wbtcTa2] = deriveTickArrays(
      WSOL_WBTC_POOL,
      wbtcInfo.tickCurrentIndex,
      wbtcInfo.tickSpacing,
    );
    const wbtcOracle = findOraclePda(WSOL_WBTC_POOL);

    const wethPoolInfo = await program_status(
      connection,
      WSOL_WETH_POOL,
      "WSOL/WETH Pool",
    );
    const wethInfo = parseWhirlpool(Buffer.from(wethPoolInfo.data));
    const wethAtoB = wethInfo.tokenMintA.equals(WSOL_MINT); // true since WSOL is token A
    const [wethTa0, wethTa1, wethTa2] = deriveTickArrays(
      WSOL_WETH_POOL,
      wethInfo.tickCurrentIndex,
      wethInfo.tickSpacing,
    );
    const wethOracle = findOraclePda(WSOL_WETH_POOL);

    // 3. Wipe oracles
    await surfnetWipeAccount(connection, usdcOracle);
    await surfnetWipeAccount(connection, wbtcOracle);
    await surfnetWipeAccount(connection, wethOracle);
    console.log(" 🧹 Wiped USDC, WBTC, and WETH oracles before swap");

    // 4. Derive ATAs
    const vaultUsdcAta = findAta(vaultAuthority, USDC_MINT);
    const vaultWsolAta = findAta(vaultAuthority, WSOL_MINT);
    const wbtcMint = wbtcAtoB ? wbtcInfo.tokenMintB : wbtcInfo.tokenMintA;
    const wethMint = wethAtoB ? wethInfo.tokenMintB : wethInfo.tokenMintA;
    const vaultWbtcAta = findAta(vaultAuthority, wbtcMint);
    const vaultWethAta = findAta(vaultAuthority, wethMint);

    await ensureAta(provider, vaultAuthority, wbtcMint);
    await ensureAta(provider, vaultAuthority, wethMint);

    const vaultBalancesBefore = await getVaultTokenBalances({
      usdc: vaultUsdcAta,
      wsol: vaultWsolAta,
      wbtc: vaultWbtcAta,
      weth: vaultWethAta,
    });
    logVaultTokenBalances("before swap_usdc_to_assets", vaultBalancesBefore);

    // 5. Create Address Lookup Table (LUT) to avoid transaction too large error
    const lookupTableAccount = await createAndExtendLut(provider, [
      vaultPda,
      vaultAuthority,
      SystemProgram.programId,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      signerUsdcAta,
      vaultUsdcAta,
      USDC_MINT,
      vaultWsolAta,
      WSOL_MINT,
      vaultWbtcAta,
      wbtcMint,
      vaultWethAta,
      wethMint,
      WHIRLPOOL_PROGRAM_ID,
      WSOL_USDC_POOL,
      usdcInfo.tokenVaultA,
      usdcInfo.tokenVaultB,
      usdcTa0,
      usdcTa1,
      usdcTa2,
      usdcOracle,
      WSOL_WBTC_POOL,
      wbtcInfo.tokenVaultA,
      wbtcInfo.tokenVaultB,
      wbtcTa0,
      wbtcTa1,
      wbtcTa2,
      wbtcOracle,
      WSOL_WETH_POOL,
      wethInfo.tokenVaultA,
      wethInfo.tokenVaultB,
      wethTa0,
      wethTa1,
      wethTa2,
      wethOracle,
    ]);
    lookupTableAddress = lookupTableAccount.key;

    // Define amounts: swap 500 USDC to SOL, then split 0.5 SOL to WBTC and 0.5 SOL to WETH
    const WBTC_SOL_IN = 500_000_000; // 0.5 SOL
    const WETH_SOL_IN = 500_000_000; // 0.5 SOL

    const swapInstruction = await program.methods
      .swapUsdcToAssets(
        new anchor.BN(USDC_AMOUNT_IN),
        new anchor.BN(0), // usdc_min_wsol_out
        usdcAtoB,
        new anchor.BN(WBTC_SOL_IN),
        new anchor.BN(0), // wbtc_min_out
        wbtcAtoB,
        new anchor.BN(WETH_SOL_IN),
        new anchor.BN(0), // weth_min_out
        wethAtoB,
      )
      .accounts({
        signer,
        vault: vaultPda,
        vaultAuthority,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        signerUsdcAta,
        vaultUsdcAta,
        usdcMint: USDC_MINT,
        vaultWsolAta,
        wsolMint: WSOL_MINT,
        vaultWbtcAta,
        wbtcMint,
        vaultWethAta,
        wethMint,
        whirlpoolProgram: WHIRLPOOL_PROGRAM_ID,
        usdcWhirlpool: WSOL_USDC_POOL,
        usdcTokenOwnerA: vaultWsolAta,
        usdcVaultA: usdcInfo.tokenVaultA,
        usdcTokenOwnerB: vaultUsdcAta,
        usdcVaultB: usdcInfo.tokenVaultB,
        usdcTickArray0: usdcTa0,
        usdcTickArray1: usdcTa1,
        usdcTickArray2: usdcTa2,
        usdcOracle,
        wbtcWhirlpool: WSOL_WBTC_POOL,
        wbtcTokenOwnerA: vaultWsolAta,
        wbtcVaultA: wbtcInfo.tokenVaultA,
        wbtcTokenOwnerB: vaultWbtcAta,
        wbtcVaultB: wbtcInfo.tokenVaultB,
        wbtcTickArray0: wbtcTa0,
        wbtcTickArray1: wbtcTa1,
        wbtcTickArray2: wbtcTa2,
        wbtcOracle,
        wethWhirlpool: WSOL_WETH_POOL,
        wethTokenOwnerA: vaultWsolAta,
        wethVaultA: wethInfo.tokenVaultA,
        wethTokenOwnerB: vaultWethAta,
        wethVaultB: wethInfo.tokenVaultB,
        wethTickArray0: wethTa0,
        wethTickArray1: wethTa1,
        wethTickArray2: wethTa2,
        wethOracle,
      } as any)
      .instruction();

    const latestBlockhash = await connection.getLatestBlockhash();
    const messageV0 = new TransactionMessage({
      payerKey: signer,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [swapInstruction],
    }).compileToV0Message([lookupTableAccount]);

    const transaction = new VersionedTransaction(messageV0);
    await provider.wallet.signTransaction(transaction);

    const tx = await connection.sendTransaction(transaction);
    await connection.confirmTransaction(tx, "confirmed");

    console.log(`  swap_usdc_to_assets tx: ${tx}`);
    await logCu(connection, tx, "swap_usdc_to_assets");

    const vaultBalancesAfter = await getVaultTokenBalances({
      usdc: vaultUsdcAta,
      wsol: vaultWsolAta,
      wbtc: vaultWbtcAta,
      weth: vaultWethAta,
    });
    logVaultTokenBalances("after swap_usdc_to_assets", vaultBalancesAfter);

    const vault = await program.account.vault.fetch(vaultPda);
    assert.isTrue(vault.btcAmount.toNumber() > 0, "btcAmount should be > 0");
    assert.isTrue(vault.ethAmount.toNumber() > 0, "ethAmount should be > 0");
    console.log(
      `  ✅ swap_usdc_to_assets complete: WBTC=${vault.btcAmount} WETH=${vault.ethAmount}`,
    );
  });

  it("swap_assets_to_usdc: vault swaps WBTC & WETH → SOL → USDC", async () => {
    console.log("\n Test 5 \n");

    // 1. Fetch pool info & tick arrays
    const usdcPoolInfo = await program_status(
      connection,
      WSOL_USDC_POOL,
      "WSOL/USDC Pool",
    );
    const usdcInfo = parseWhirlpool(Buffer.from(usdcPoolInfo.data));
    const usdcAtoB = usdcInfo.tokenMintA.equals(USDC_MINT); // false since WSOL is token A
    const [usdcTa0, usdcTa1, usdcTa2] = deriveTickArrays(
      WSOL_USDC_POOL,
      usdcInfo.tickCurrentIndex,
      usdcInfo.tickSpacing,
    );
    const usdcOracle = findOraclePda(WSOL_USDC_POOL);

    const wbtcPoolInfo = await program_status(
      connection,
      WSOL_WBTC_POOL,
      "WSOL/WBTC Pool",
    );
    const wbtcInfo = parseWhirlpool(Buffer.from(wbtcPoolInfo.data));
    const wbtcAtoB = wbtcInfo.tokenMintA.equals(WSOL_MINT); // true since WSOL is token A
    const [wbtcTa0, wbtcTa1, wbtcTa2] = deriveTickArrays(
      WSOL_WBTC_POOL,
      wbtcInfo.tickCurrentIndex,
      wbtcInfo.tickSpacing,
    );
    const wbtcOracle = findOraclePda(WSOL_WBTC_POOL);

    const wethPoolInfo = await program_status(
      connection,
      WSOL_WETH_POOL,
      "WSOL/WETH Pool",
    );
    const wethInfo = parseWhirlpool(Buffer.from(wethPoolInfo.data));
    const wethAtoB = wethInfo.tokenMintA.equals(WSOL_MINT); // true since WSOL is token A
    const [wethTa0, wethTa1, wethTa2] = deriveTickArrays(
      WSOL_WETH_POOL,
      wethInfo.tickCurrentIndex,
      wethInfo.tickSpacing,
    );
    const wethOracle = findOraclePda(WSOL_WETH_POOL);

    // 2. Fetch current balances
    const vaultBefore = await program.account.vault.fetch(vaultPda);
    const wbtcAmountIn = vaultBefore.btcAmount.toNumber();
    const wethAmountIn = vaultBefore.ethAmount.toNumber();

    // 3. Wipe oracles
    await surfnetWipeAccount(connection, usdcOracle);
    await surfnetWipeAccount(connection, wbtcOracle);
    await surfnetWipeAccount(connection, wethOracle);
    console.log("  🧹 Wiped USDC, WBTC, and WETH oracles before swap");

    // 4. Derive ATAs
    const vaultUsdcAta = findAta(vaultAuthority, USDC_MINT);
    const vaultWsolAta = findAta(vaultAuthority, WSOL_MINT);
    const wbtcMint = wbtcAtoB ? wbtcInfo.tokenMintB : wbtcInfo.tokenMintA;
    const wethMint = wethAtoB ? wethInfo.tokenMintB : wethInfo.tokenMintA;
    const vaultWbtcAta = findAta(vaultAuthority, wbtcMint);
    const vaultWethAta = findAta(vaultAuthority, wethMint);

    const vaultBalancesBefore = await getVaultTokenBalances({
      usdc: vaultUsdcAta,
      wsol: vaultWsolAta,
      wbtc: vaultWbtcAta,
      weth: vaultWethAta,
    });
    logVaultTokenBalances("before swap_assets_to_usdc", vaultBalancesBefore);

    // Fetch the lookup table account
    const lookupTableAccount = (
      await connection.getAddressLookupTable(lookupTableAddress)
    ).value;
    if (!lookupTableAccount) {
      throw new Error("Failed to retrieve Address Lookup Table account");
    }

    const swapInstruction = await program.methods
      .swapAssetsToUsdc(
        new anchor.BN(wbtcAmountIn),
        new anchor.BN(0), // wbtc_min_wsol_out
        !wbtcAtoB, // swapping WBTC -> SOL (B to A, so false)
        new anchor.BN(wethAmountIn),
        new anchor.BN(0), // weth_min_wsol_out
        !wethAtoB, // swapping WETH -> SOL (B to A, so false)
        new anchor.BN(0), // wsol_min_usdc_out
        !usdcAtoB, // swapping wSOL -> USDC (A to B, so true)
      )
      .accounts({
        signer,
        vault: vaultPda,
        vaultAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
        vaultWbtcAta,
        wbtcMint,
        vaultWethAta,
        wethMint,
        vaultWsolAta,
        wsolMint: WSOL_MINT,
        vaultUsdcAta,
        usdcMint: USDC_MINT,
        whirlpoolProgram: WHIRLPOOL_PROGRAM_ID,
        wbtcWhirlpool: WSOL_WBTC_POOL,
        wbtcTokenOwnerA: vaultWsolAta,
        wbtcVaultA: wbtcInfo.tokenVaultA,
        wbtcTokenOwnerB: vaultWbtcAta,
        wbtcVaultB: wbtcInfo.tokenVaultB,
        wbtcTickArray0: wbtcTa0,
        wbtcTickArray1: wbtcTa1,
        wbtcTickArray2: wbtcTa2,
        wbtcOracle,
        wethWhirlpool: WSOL_WETH_POOL,
        wethTokenOwnerA: vaultWsolAta,
        wethVaultA: wethInfo.tokenVaultA,
        wethTokenOwnerB: vaultWethAta,
        wethVaultB: wethInfo.tokenVaultB,
        wethTickArray0: wethTa0,
        wethTickArray1: wethTa1,
        wethTickArray2: wethTa2,
        wethOracle,
        usdcWhirlpool: WSOL_USDC_POOL,
        usdcTokenOwnerA: vaultWsolAta,
        usdcVaultA: usdcInfo.tokenVaultA,
        usdcTokenOwnerB: vaultUsdcAta,
        usdcVaultB: usdcInfo.tokenVaultB,
        usdcTickArray0: usdcTa0,
        usdcTickArray1: usdcTa1,
        usdcTickArray2: usdcTa2,
        usdcOracle,
      } as any)
      .instruction();

    const latestBlockhash = await connection.getLatestBlockhash();
    const messageV0 = new TransactionMessage({
      payerKey: signer,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [swapInstruction],
    }).compileToV0Message([lookupTableAccount]);

    const transaction = new VersionedTransaction(messageV0);
    await provider.wallet.signTransaction(transaction);

    const tx = await connection.sendTransaction(transaction);
    await connection.confirmTransaction(tx, "confirmed");

    console.log(`  swap_assets_to_usdc tx: ${tx}`);
    await logCu(connection, tx, "swap_assets_to_usdc");

    const vaultBalancesAfter = await getVaultTokenBalances({
      usdc: vaultUsdcAta,
      wsol: vaultWsolAta,
      wbtc: vaultWbtcAta,
      weth: vaultWethAta,
    });
    logVaultTokenBalances("after swap_assets_to_usdc", vaultBalancesAfter);

    const vault = await program.account.vault.fetch(vaultPda);
    assert.equal(vault.btcAmount.toNumber(), 0, "btcAmount should be 0");
    assert.equal(vault.ethAmount.toNumber(), 0, "ethAmount should be 0");
    assert.isTrue(
      vault.usdcAmount.toNumber() > vaultBefore.usdcAmount.toNumber(),
      "usdcAmount should increase",
    );
    console.log(`  ✅ swap_assets_to_usdc complete: USDC=${vault.usdcAmount}`);
  });
});
