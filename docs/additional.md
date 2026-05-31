# LiteSVM

```ts
/** Derive vault_authority PDA. */
function findVaultAuthority(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([VAULT_AUTHORITY_SEED], PROGRAM_ID);
}

/** Derive the ATA address for a given owner + mint. */
function findAta(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

/**
 * Clone a single account from mainnet into the SVM.
 * Returns the raw AccountInfo bytes for further inspection.
 */
async function cloneAccount(
  svm: LiteSVM,
  conn: Connection,
  address: PublicKey,
): Promise<Buffer> {
  const info = await conn.getAccountInfo(address);
  if (!info)
    throw new Error(`Account not found on mainnet: ${address.toBase58()}`);
  svm.setAccount(address, {
    lamports: info.lamports,
    data: new Uint8Array(info.data),
    owner: info.owner,
    executable: info.executable,
  });
  return Buffer.from(info.data);
}

/**
 * Parse a Whirlpool account to extract token_mint_a, token_mint_b,
 * token_vault_a, token_vault_b, and the three tick array start indexes
 * needed for the current sqrt_price.
 *
 * Whirlpool account layout (after 8-byte discriminator):
 *   whirlpools_config: Pubkey       [8..40]
 *   whirlpool_bump: [u8;1]          [40..41]
 *   tick_spacing: u16               [41..43]
 *   tick_spacing_seed: [u8;2]       [43..45]
 *   fee_rate: u16                   [45..47]
 *   protocol_fee_rate: u16          [47..49]
 *   liquidity: u128                 [49..65]
 *   sqrt_price: u128                [65..81]
 *   tick_current_index: i32         [81..85]
 *   protocol_fee_owed_a: u64        [85..93]
 *   protocol_fee_owed_b: u64        [93..101]
 *   token_mint_a: Pubkey            [101..133]
 *   token_vault_a: Pubkey           [133..165]
 *   fee_growth_global_a: u128       [165..181]
 *   token_mint_b: Pubkey            [181..213]
 *   token_vault_b: Pubkey           [213..245]
 */
interface WhirlpoolInfo {
  tokenMintA: PublicKey;
  tokenVaultA: PublicKey;
  tokenMintB: PublicKey;
  tokenVaultB: PublicKey;
  tickSpacing: number;
  tickCurrentIndex: number;
  sqrtPrice: bigint;
}

function parseWhirlpool(data: Buffer): WhirlpoolInfo {
  const tokenMintA = new PublicKey(data.subarray(101, 133));
  const tokenVaultA = new PublicKey(data.subarray(133, 165));
  const tokenMintB = new PublicKey(data.subarray(181, 213));
  const tokenVaultB = new PublicKey(data.subarray(213, 245));
  const tickSpacing = data.readUInt16LE(41);
  const tickCurrentIndex = data.readInt32LE(81);
  const sqrtPrice = data.readBigUInt64LE(65);

  return {
    tokenMintA,
    tokenVaultA,
    tokenMintB,
    tokenVaultB,
    tickSpacing,
    tickCurrentIndex,
    sqrtPrice,
  };
}

/**
 * Derive tick array start index for a given tick_index.
 * TICK_ARRAY_SIZE = 88 ticks per array.
 */
const TICK_ARRAY_SIZE = 88;

function tickArrayStartIndex(tickIndex: number, tickSpacing: number): number {
  const realTickSpacing = Math.max(tickSpacing, 1);
  const ticksPerArray = TICK_ARRAY_SIZE * realTickSpacing;
  return Math.floor(tickIndex / ticksPerArray) * ticksPerArray;
}

/** Derive the tick array PDA for a given whirlpool + start_tick_index. */
function findTickArrayPda(
  whirlpool: PublicKey,
  startTickIndex: number,
): PublicKey {
  // Anchor uses the decimal string representation of start_tick_index as seed
  const seed = Buffer.from(String(startTickIndex));
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("tick_array"), whirlpool.toBuffer(), seed],
    WHIRLPOOL_PROGRAM_ID,
  );
  return pda;
}

/** Derive the Whirlpool oracle PDA. */
function findOraclePda(whirlpool: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), whirlpool.toBuffer()],
    WHIRLPOOL_PROGRAM_ID,
  );
  return pda;
}

/**
 * Clone a whirlpool and all accounts it needs for a swap:
 * - pool itself
 * - token_vault_a, token_vault_b
 * - 3 tick arrays centered on current_tick_index
 * - oracle PDA
 * - both token mints
 *
 * Returns addresses for building the swap instruction.
 */
interface PoolAccounts {
  pool: PublicKey;
  tokenMintA: PublicKey;
  tokenVaultA: PublicKey;
  tokenMintB: PublicKey;
  tokenVaultB: PublicKey;
  tickArray0: PublicKey;
  tickArray1: PublicKey;
  tickArray2: PublicKey;
  oracle: PublicKey;
}

async function cloneWhirlpoolAccounts(
  svm: LiteSVM,
  conn: Connection,
  poolAddress: PublicKey,
): Promise<PoolAccounts> {
  // Clone pool itself
  const poolData = await cloneAccount(svm, conn, poolAddress);
  const pool = parseWhirlpool(poolData);

  // Clone token mints
  await cloneAccount(svm, conn, pool.tokenMintA);
  await cloneAccount(svm, conn, pool.tokenMintB);

  // Clone token vaults
  await cloneAccount(svm, conn, pool.tokenVaultA);
  await cloneAccount(svm, conn, pool.tokenVaultB);

  // Derive 3 tick arrays around current tick (0, -1, +1 offsets)
  const ticksPerArray = TICK_ARRAY_SIZE * pool.tickSpacing;
  const start0 = tickArrayStartIndex(pool.tickCurrentIndex, pool.tickSpacing);
  const start1 = start0 - ticksPerArray;
  const start2 = start0 + ticksPerArray;

  const ta0 = findTickArrayPda(poolAddress, start0);
  const ta1 = findTickArrayPda(poolAddress, start1);
  const ta2 = findTickArrayPda(poolAddress, start2);

  // Clone tick arrays (they may not exist on-chain; use a stub if missing)
  for (const [addr, start] of [
    [ta0, start0],
    [ta1, start1],
    [ta2, start2],
  ] as [PublicKey, number][]) {
    const info = await conn.getAccountInfo(addr);
    if (info) {
      svm.setAccount(addr, {
        lamports: info.lamports,
        data: new Uint8Array(info.data),
        owner: info.owner,
        executable: false,
      });
    } else {
      console.log(
        `  tick array ${addr.toBase58()} (start=${start}) not on-chain, skipping`,
      );
    }
  }

  // Clone oracle
  const oracle = findOraclePda(poolAddress);
  const oracleInfo = await conn.getAccountInfo(oracle);
  if (oracleInfo) {
    svm.setAccount(oracle, {
      lamports: oracleInfo.lamports,
      data: new Uint8Array(oracleInfo.data),
      owner: oracleInfo.owner,
      executable: false,
    });
  }

  return {
    pool: poolAddress,
    tokenMintA: pool.tokenMintA,
    tokenVaultA: pool.tokenVaultA,
    tokenMintB: pool.tokenMintB,
    tokenVaultB: pool.tokenVaultB,
    tickArray0: ta0,
    tickArray1: ta1,
    tickArray2: ta2,
    oracle,
  };
}

/**
 * Create an empty SPL token account (ATA stub) in the SVM.
 * Layout: mint(32) + owner(32) + amount(8) + delegate_option(4) + delegate(32)
 *       + state(1) + is_native_option(4) + is_native(8) + delegated_amount(8)
 *       + close_authority_option(4) + close_authority(32) = 165 bytes
 */
function seedTokenAccount(
  svm: LiteSVM,
  address: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  amount: bigint = 0n,
): void {
  const data = Buffer.alloc(165);
  // mint
  mint.toBuffer().copy(data, 0);
  // owner
  owner.toBuffer().copy(data, 32);
  // amount
  data.writeBigUInt64LE(amount, 64);
  // state = 1 (initialized)
  data[108] = 1;

  svm.setAccount(address, {
    lamports: 2_039_280, // rent-exempt minimum for token account
    data: new Uint8Array(data),
    owner: TOKEN_PROGRAM_ID,
    executable: false,
  });
}
```
