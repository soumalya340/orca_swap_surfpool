use anchor_lang::prelude::*;

mod constants;
mod distribute;
mod instructions;
mod state;
mod utils;

pub use constants::*;
pub use distribute::*;
pub use instructions::*;
pub use state::*;
pub use utils::*;

declare_id!("H7tuzzuJNLWYkqjGrepS19NYrH3qhudsuBntHJweW9By");

#[program]
pub mod orca_swap {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        handle_initialize(ctx)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn swap_sol_to_assets(
        ctx: Context<SwapSolToAssets>,
        sol_amount: u64,
        wbtc_amount_in: u64,
        wbtc_min_out: u64,
        wbtc_a_to_b: bool,
        weth_amount_in: u64,
        weth_min_out: u64,
        weth_a_to_b: bool,
    ) -> Result<()> {
        handle_swap_sol_to_assets(
            ctx,
            sol_amount,
            wbtc_amount_in,
            wbtc_min_out,
            wbtc_a_to_b,
            weth_amount_in,
            weth_min_out,
            weth_a_to_b,
        )
    }

    pub fn swap_wsol_to_usdc(
        ctx: Context<SwapWsolToUsdc>,
        sol_amount_in: u64,
        min_usdc_out: u64,
        a_to_b: bool,
    ) -> Result<()> {
        handle_swap_wsol_to_usdc(ctx, sol_amount_in, min_usdc_out, a_to_b)
    }

    pub fn distribute_all(ctx: Context<DistributeAll>) -> Result<()> {
        handle_distribute_all(ctx)
    }
}
