use anchor_lang::prelude::*;

pub const ANCHOR_DISCRIMINATOR: usize = 8;

/// Only this public key is allowed to call admin-gated instructions.
pub const ADMIN_PUBKEY: Pubkey = pubkey!("cyaibXfQvCC4qKDYNguU4mXryhKjSkszPWkd56KFkrF");

/// Orca Whirlpool program (mainnet + devnet).
pub const WHIRLPOOL_PROGRAM_ID: Pubkey =
    pubkey!("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");

pub const VAULT_AUTHORITY_SEED: &[u8] = b"vault_authority";
pub const VAULT_SEED: &[u8] = b"vault";

/// Wrapped SOL mint (mainnet).
pub const WSOL_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");

/// USDC mint (mainnet).
pub const USDC_MINT: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

/// WBTC mint (mainnet).
pub const WBTC_MINT: Pubkey = pubkey!("3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh");

/// WETH mint (mainnet).
pub const WETH_MINT: Pubkey = pubkey!("7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs");

/// Orca Whirlpool SOL/USDC pool (mainnet).
pub const WSOL_USDC_POOL: Pubkey = pubkey!("Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE");

/// Orca Whirlpool `swap` instruction discriminator (from idls/orca_whirlpool.json).
pub const WHIRLPOOL_SWAP_DISCRIMINATOR: [u8; 8] =
    [248, 198, 158, 145, 225, 117, 135, 200];

/// Whirlpool sqrt price bounds (from deps/whirlpools tick_math.rs).
pub const MIN_SQRT_PRICE_X64: u128 = 4_295_048_016;
pub const MAX_SQRT_PRICE_X64: u128 = 79_226_673_515_401_279_992_447_579_055;
