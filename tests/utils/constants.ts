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

export const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);

export const WSOL_USDC_POOL = new PublicKey(
  "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
);

/** Deployed orca_swap program id (must match on-chain declare_id). */
export const ORCA_SWAP_PROGRAM_ID = new PublicKey(
  "3fibbMCVGUsTRiXerNeMNg6khBrG2iyo61mPUpJcoM5H",
);
