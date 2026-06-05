import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { OrcaSwap } from "../target/types/orca_swap";
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
} from "./utils/constants";

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const program = anchor.workspace.orcaSwap as Program<OrcaSwap>;
const connection = provider.connection;
const signer = provider.wallet.publicKey;

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
    const existingVaultInfo = await connection.getAccountInfo(vaultPda);
    const wasAlreadyInitialized = existingVaultInfo !== null;

    await program.methods
      .initialize()
      .accounts({
        signer,
        vault: vaultPda,
        vaultAuthority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

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

    const SOL_AMOUNT = 0.01 * 1e9;
    const WBTC_AMOUNT_IN = Math.floor(SOL_AMOUNT * 0.5);
    const WETH_AMOUNT_IN = Math.floor(SOL_AMOUNT * 0.5);

    await program.methods
      .swapSolToAssets(
        new anchor.BN(SOL_AMOUNT),
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
});
