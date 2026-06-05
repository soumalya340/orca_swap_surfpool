use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace, Default)]
pub struct Vault {
    pub btc_amount: u64,
    pub eth_amount: u64,
    pub sol_amount: u64,
    pub usdc_amount: u64,
    pub authority_bump: u8,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Only the admin can call this instruction.")]
    UnauthorizedAdmin,
    #[msg("Pinocchio CPI call failed.")]
    CpiFailure,
    #[msg("Swap input amounts exceed wrapped SOL amount.")]
    InvalidSwapAmounts,
    #[msg("Incorrect token account owner.")]
    IncorrectOwner,
    #[msg("Invalid token mint.")]
    InvalidMint,
    #[msg("WSOL swap amount exceeds vault WSOL balance.")]
    InsufficientWsolBalance,
    #[msg("Required vault token account has not been initialized (must be pre-created off-chain).")]
    AccountNotInitialized,
}
