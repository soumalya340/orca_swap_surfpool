// import {
//   AnchorProvider,
//   BN,
//   BorshAccountsCoder,
//   Program,
//   Wallet,
// } from "@coral-xyz/anchor";
// import {
//   clusterApiUrl,
//   Connection,
//   Keypair,
//   PublicKey,
//   Transaction,
// } from "@solana/web3.js";
// import {
//   FailedTransactionMetadata,
//   LiteSVM,
//   TransactionMetadata,
// } from "litesvm";
// import path from "path";
// import fs from "fs";
// import os from "os";
// import { expect } from "chai";
// import OrcaSwapIDL from "../../target/idl/orca_swap.json";
// import { OrcaSwap } from "../../target/types/orca_swap";

// // ─────────────────────────────────────────────
// // Constants
// // ─────────────────────────────────────────────
// const PROGRAM_ID = new PublicKey(OrcaSwapIDL.address);

// const WHIRLPOOL_PROGRAM_ID = new PublicKey(
//   "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
// );

// // Pool addresses from misc.md
// const WSOL_WBTC_POOL = new PublicKey(
//   "B5EwJVDuAauzUEEdwvbuXzbFFgEYnUqqS37TUM1c4PQA",
// );
// const WSOL_WETH_POOL = new PublicKey(
//   "HktfL7iwGKT5QHjywQkcDnZXScoh811k7akrMZJkCcEF",
// );

// const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
// const TOKEN_PROGRAM_ID = new PublicKey(
//   "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
// );
// const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
//   "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bJ4",
// );

// const VAULT_AUTHORITY_SEED = Buffer.from("vault_authority");
// const VAULT_SEED = Buffer.from("vault");

// // ─────────────────────────────────────────────
// // Helpers
// // ─────────────────────────────────────────────

// /** Load the admin keypair from ~/.config/solana/id.json (Anchor.toml wallet). */
// function loadAdminSigner(): Keypair {
//   const walletPath = path.resolve(os.homedir(), ".config/solana/id.json");
//   const secret = Uint8Array.from(
//     JSON.parse(fs.readFileSync(walletPath, "utf-8")),
//   );
//   return Keypair.fromSecretKey(secret);
// }

// /** Boot a fresh LiteSVM instance with the orca_swap + whirlpool programs loaded. */
// function startSvm(): LiteSVM {
//   const svm = new LiteSVM();
//   svm.addProgramFromFile(
//     PROGRAM_ID,
//     path.resolve("./target/deploy/orca_swap.so"),
//   );
//   svm.addProgramFromFile(
//     WHIRLPOOL_PROGRAM_ID,
//     path.resolve("./tests/programs/orca-whirlpool.so"),
//   );
//   return svm;
// }

// /**
//  * Program object is used only for IDL/transaction building.
//  * Actual execution goes through LiteSVM, not a real RPC connection.
//  */
// function createProgram(adminSigner: Keypair): Program<OrcaSwap> {
//   const wallet = new Wallet(adminSigner);
//   const provider = new AnchorProvider(
//     new Connection(clusterApiUrl("devnet")),
//     wallet,
//     {},
//   );
//   return new Program<OrcaSwap>(OrcaSwapIDL as OrcaSwap, provider);
// }

// /** Sign and send a transaction through LiteSVM; throws on failure with logs. */
// function sendTx(
//   svm: LiteSVM,
//   tx: Transaction,
//   signers: Keypair[],
// ): TransactionMetadata {
//   tx.recentBlockhash = svm.latestBlockhash();
//   tx.sign(...signers);
//   const result = svm.sendTransaction(tx);
//   svm.expireBlockhash();
//   if (result instanceof FailedTransactionMetadata) {
//     throw new Error(result.meta().logs().join("\n"));
//   }
//   return result;
// }

// // ─────────────────────────────────────────────
// // Tests
// // ─────────────────────────────────────────────
// describe("orca_swap", () => {
//   let svm: LiteSVM;
//   let adminSigner: Keypair;
//   let vaultPda: PublicKey;
//   let program: Program<OrcaSwap>;

//   beforeEach(() => {
//     svm = startSvm();

//     adminSigner = loadAdminSigner();
//     [vaultPda] = PublicKey.findProgramAddressSync(
//       [VAULT_SEED, adminSigner.publicKey.toBytes()],
//       PROGRAM_ID,
//     );

//     // Fund the admin so it can pay rent + fees inside the SVM
//     svm.airdrop(adminSigner.publicKey, BigInt(10_000_000_000));

//     program = createProgram(adminSigner);
//   });

//   it("initialize: creates the Vault account and all amounts default to zero", async () => {
//     const initTx = (await program.methods
//       .initialize()
//       .accounts({
//         vault: vaultPda,
//       })
//       .transaction()) as Transaction;

//     sendTx(svm, initTx, [adminSigner]);

//     // ── Fetch the raw account bytes from the SVM ──────────────────────────
//     const raw = svm.getAccount(vaultPda);
//     expect(raw, "vault account should exist after initialize").to.not.be.null;

//     // ── Decode with BorshAccountsCoder (strips the 8-byte discriminator) ──
//     const coder = new BorshAccountsCoder(OrcaSwapIDL as any);
//     const decoded = coder.decode("Vault", Buffer.from(raw!.data));

//     console.log("Vault state after initialize:");
//     console.log("  btc_amount :", decoded.btc_amount.toString());
//     console.log("  eth_amount :", decoded.eth_amount.toString());
//     console.log("  sol_amount :", decoded.sol_amount.toString());

//     // All fields derive Default → u64::default() == 0
//     expect(decoded.btc_amount.toNumber()).to.equal(0);
//     expect(decoded.eth_amount.toNumber()).to.equal(0);
//     expect(decoded.sol_amount.toNumber()).to.equal(0);
//   });
// });
