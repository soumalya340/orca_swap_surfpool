use anchor_lang::prelude::*;

pub const ANCHOR_DISCRIMINATOR: usize = 8;

/// Only this public key is allowed to call admin-gated instructions.
pub const ADMIN_PUBKEY: Pubkey = pubkey!("cyaibXfQvCC4qKDYNguU4mXryhKjSkszPWkd56KFkrF");

/// Orca Whirlpool program (mainnet + devnet).
pub const WHIRLPOOL_PROGRAM_ID: Pubkey =
    pubkey!("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");

pub const VAULT_AUTHORITY_SEED: &[u8] = b"vault_authority";
pub const VAULT_SEED: &[u8] = b"vault";

/// Orca Whirlpool `swap` instruction discriminator (from idls/orca_whirlpool.json).
pub const WHIRLPOOL_SWAP_DISCRIMINATOR: [u8; 8] =
    [248, 198, 158, 145, 225, 117, 135, 200];

/// Whirlpool sqrt price bounds (from deps/whirlpools tick_math.rs).
pub const MIN_SQRT_PRICE_X64: u128 = 4_295_048_016;
pub const MAX_SQRT_PRICE_X64: u128 = 79_226_673_515_401_279_992_447_579_055;
