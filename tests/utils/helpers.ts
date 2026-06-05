import * as anchor from "@coral-xyz/anchor";
import {
  AccountInfo,
  Connection,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID as SPL_TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

export const WHIRLPOOL_PROGRAM_ID = new PublicKey(
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
);

const TICK_ARRAY_SIZE = 88;

export interface WhirlpoolInfo {
  tokenMintA: PublicKey;
  tokenVaultA: PublicKey;
  tokenMintB: PublicKey;
  tokenVaultB: PublicKey;
  tickSpacing: number;
  tickCurrentIndex: number;
  rewardLastUpdatedTimestamp: anchor.BN;
}

export function parseWhirlpool(data: Buffer): WhirlpoolInfo {
  return {
    tokenMintA: new PublicKey(data.subarray(101, 133)),
    tokenVaultA: new PublicKey(data.subarray(133, 165)),
    tokenMintB: new PublicKey(data.subarray(181, 213)),
    tokenVaultB: new PublicKey(data.subarray(213, 245)),
    tickSpacing: data.readUInt16LE(41),
    tickCurrentIndex: data.readInt32LE(81),
    rewardLastUpdatedTimestamp: new anchor.BN(
      data.readBigUInt64LE(261).toString(),
    ),
  };
}

export function findTickArrayPda(
  pool: PublicKey,
  startIndex: number,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("tick_array"),
      pool.toBuffer(),
      Buffer.from(String(startIndex)),
    ],
    WHIRLPOOL_PROGRAM_ID,
  );
  return pda;
}

export function findOraclePda(pool: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), pool.toBuffer()],
    WHIRLPOOL_PROGRAM_ID,
  );
  return pda;
}

export function deriveTickArrays(
  pool: PublicKey,
  tickCurrentIndex: number,
  tickSpacing: number,
): [PublicKey, PublicKey, PublicKey] {
  const ticksPerArray = TICK_ARRAY_SIZE * tickSpacing;
  const start0 = Math.floor(tickCurrentIndex / ticksPerArray) * ticksPerArray;
  return [
    findTickArrayPda(pool, start0),
    findTickArrayPda(pool, start0 - ticksPerArray),
    findTickArrayPda(pool, start0 + ticksPerArray),
  ];
}

export function findAta(owner: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    true,
    SPL_TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

export async function ensureAta(
  provider: anchor.AnchorProvider,
  owner: PublicKey,
  mint: PublicKey,
): Promise<PublicKey> {
  const signer = provider.wallet.publicKey;
  const ata = findAta(owner, mint);
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      signer,
      ata,
      owner,
      mint,
      SPL_TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
  );
  await provider.sendAndConfirm(tx);
  return ata;
}

export async function surfnetRpc(
  connection: Connection,
  method: string,
  params: unknown[],
): Promise<unknown> {
  try {
    // @ts-ignore — _rpcRequest is not in the public Connection type
    const result = await (connection as any)._rpcRequest(method, params);
    if (result.error) {
      throw new Error(`${method} failed: ${JSON.stringify(result.error)}`);
    }
    return result.result;
  } catch (err: any) {
    console.warn(
      `[Surfnet RPC Warning] ${method} call failed (expected if running on standard solana-test-validator):`,
      err.message || err,
    );
    return null;
  }
}

export async function surfnetWipeAccount(
  connection: Connection,
  pubkey: PublicKey,
): Promise<void> {
  await surfnetRpc(connection, "surfnet_setAccount", [
    pubkey.toBase58(),
    {
      lamports: 10000000, // Non-zero lamports prevents garbage collection / JIT re-fetching
      data: "",
      owner: "11111111111111111111111111111111",
      executable: false,
    },
  ]);
}

export async function program_status(
  connection: Connection,
  program_id: PublicKey,
  program_name: string,
  hint?: string,
): Promise<AccountInfo<Buffer>> {
  const programAccount = await connection.getAccountInfo(program_id);
  if (!programAccount) {
    const suffix = hint ? ` — ${hint}` : "";
    throw new Error(
      `${program_name} (${program_id.toBase58()}) not found${suffix}`,
    );
  }
  return programAccount;
}
