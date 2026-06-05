import { PublicKey } from "@solana/web3.js";

// ─── Constants ────────────────────────────────────────────────────────────────

export const VAULT_SEED = Buffer.from("vault");
export const VAULT_AUTHORITY_SEED = Buffer.from("vault_authority");

export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
export const WSOL_WBTC_POOL = new PublicKey(
  "B5EwJVDuAauzUEEdwvbuXzbFFgEYnUqqS37TUM1c4PQA",
);
export const WSOL_WETH_POOL = new PublicKey(
  "HktfL7iwGKT5QHjywQkcDnZXScoh811k7akrMZJkCcEF",
);


