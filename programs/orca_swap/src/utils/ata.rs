use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::state::ErrorCode;

/// Create an ATA idempotently; if it already exists, verify owner and mint.
pub fn create_ata_idempotent<'info>(
    payer: AccountInfo<'info>,
    ata: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    associated_token_program: AccountInfo<'info>,
) -> Result<()> {
    if ata.data_is_empty() {
        msg!("Creating vault ATA idempotently for mint {}", mint.key());
        let cpi_accounts = anchor_spl::associated_token::Create {
            payer,
            associated_token: ata,
            authority,
            mint,
            system_program,
            token_program,
        };
        let cpi_ctx = CpiContext::new(associated_token_program, cpi_accounts);
        anchor_spl::associated_token::create(cpi_ctx)
            .map_err(|_| error!(ErrorCode::CpiFailure))?;
    } else {
        let data = ata.try_borrow_data()?;
        let token_account = TokenAccount::try_deserialize(&mut data.as_ref())?;
        require_keys_eq!(
            token_account.owner,
            authority.key(),
            ErrorCode::IncorrectOwner
        );
        require_keys_eq!(token_account.mint, mint.key(), ErrorCode::InvalidMint);
    }
    Ok(())
}
