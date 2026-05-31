# Surfpool RPC Cheatcodes

Powerful testing utilities unique to Surfpool for state manipulation. These methods are only available on **Surfnet**.

---

## Table of Contents

- [surfnet\_setAccount](#surfnet_setaccount)
- [surfnet\_setTokenAccount](#surfnet_settokenaccount)
- [surfnet\_cloneProgramAccount](#surfnet_cloneprogramaccount)
- [surfnet\_profileTransaction](#surfnet_profiletransaction)
- [surfnet\_getProfileResultsByTag](#surfnet_getprofileresultsbytag)
- [surfnet\_setSupply](#surfnet_setsupply)
- [surfnet\_setProgramAuthority](#surfnet_setprogramauthority)
- [surfnet\_getTransactionProfile](#surfnet_gettransactionprofile)
- [surfnet\_registerIdl](#surfnet_registeridl)
- [surfnet\_getActiveIdl](#surfnet_getactiveidl)
- [surfnet\_getLocalSignatures](#surfnet_getlocalsignatures)
- [surfnet\_timeTravel](#surfnet_timetravel)
- [surfnet\_pauseClock](#surfnet_pauseclock)
- [surfnet\_resumeClock](#surfnet_resumeclock)
- [surfnet\_resetAccount](#surfnet_resetaccount)
- [surfnet\_exportSnapshot](#surfnet_exportsnapshot)
- [surfnet\_streamAccount](#surfnet_streamaccount)
- [surfnet\_streamAccounts](#surfnet_streamaccounts)
- [surfnet\_offlineAccount](#surfnet_offlineaccount)
- [surfnet\_writeProgram](#surfnet_writeprogram)
- [surfnet\_registerScenario](#surfnet_registerscenario)
- [surfnet\_enableCheatcode](#surfnet_enablecheatcode)
- [surfnet\_disableCheatcode](#surfnet_disablecheatcode)
- [surfnet\_resetNetwork](#surfnet_resetnetwork)
- [surfnet\_getStreamedAccounts](#surfnet_getstreamedaccounts)
- [surfnet\_getSurfnetInfo](#surfnet_getsurfnetinfo)

---

## `surfnet_setAccount`

Sets or updates an account's properties including lamports, data, owner, and executable status.

### Parameters

| Name | Type | Required | Description |
|------|------|:--------:|-------------|
| `pubkey` | string | ✓ | The public key of the account to update, as a base-58 encoded string. |
| `update` | object | ✓ | The account data to update. |
| `update.data` | string | | The new account data, as a hex encoded string. |
| `update.executable` | boolean | | Whether the account should be executable (`true` for program accounts, `false` for data accounts). |
| `update.lamports` | integer | | The new balance in lamports (1 SOL = 1,000,000,000 lamports). |
| `update.owner` | string | | The new owner program ID, as a base-58 encoded string. |
| `update.rentEpoch` | integer | | The new rent epoch in which this account will next owe rent. |

### Result

| Field | Type | Description |
|-------|------|-------------|
| `context` | object | |
| `context.apiVersion` | string | The API version |
| `context.slot` | integer | The current slot |
| `value` | null | |

### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "surfnet_setAccount",
  "params": [
    "83astBRguLMdt2h5U1Tpdq5tjFoJ6noeGwaY3mDLVcri",
    {
      "data": "0x3b9aca00",
      "executable": true,
      "lamports": 1000000000,
      "owner": "11111111111111111111111111111111",
      "rentEpoch": 100
    }
  ]
}
```

---

## `surfnet_setTokenAccount`

Sets or updates a token account's properties including balance, delegate, state, and authorities.

### Parameters

| Name | Type | Required | Description |
|------|------|:--------:|-------------|
| `owner` | string | ✓ | The public key of the token account owner, as a base-58 encoded string. |
| `mint` | string | ✓ | The public key of the token mint, as a base-58 encoded string. |
| `tokenProgram` | string | | The token program ID. Defaults to the SPL Token program if not specified. |
| `update` | object | ✓ | The token account data to update. |
| `update.amount` | integer | | The new token balance in the smallest unit. |
| `update.closeAuthority` | string | | The new close authority that can close the account and recover rent. |
| `update.delegate` | string | | The new delegate account that can spend tokens on behalf of the owner. |
| `update.delegatedAmount` | integer | | The new delegated amount the delegate is authorized to spend. |
| `update.state` | string | | The new account state (e.g., `initialized`, `frozen`, `closed`). |

### Result

| Field | Type | Description |
|-------|------|-------------|
| `context` | object | |
| `context.apiVersion` | string | The API version |
| `context.slot` | integer | The current slot |
| `value` | null | |

### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "surfnet_setTokenAccount",
  "params": [
    "11111111111111111111111111111111",
    "<some-mint>",
    {
      "amount": 1000000000,
      "closeAuthority": "83astBRguLMdt2h5U1Tpdq5tjFoJ6noeGwaY3mDLVcri",
      "delegate": "83astBRguLMdt2h5U1Tpdq5tjFoJ6noeGwaY3mDLVcri",
      "delegatedAmount": 1000000000,
      "state": "<some-state>"
    },
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
  ]
}
```

---

## `surfnet_cloneProgramAccount`

Clones a program account from one program ID to another, including its associated program data.

### Parameters

| Name | Type | Required | Description |
|------|------|:--------:|-------------|
| `sourceProgramId` | string | ✓ | The public key of the source program to clone, as a base-58 encoded string. |
| `destinationProgramId` | string | ✓ | The public key of the destination program, as a base-58 encoded string. |

### Result

| Field | Type | Description |
|-------|------|-------------|
| `context` | object | |
| `context.apiVersion` | string | The API version |
| `context.slot` | integer | The current slot |
| `value` | null | |

### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "surfnet_cloneProgramAccount",
  "params": [
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
  ]
}
```

---

## `surfnet_profileTransaction`

Profiles a transaction to analyze compute units, account changes, and execution details.

### Parameters

| Name | Type | Required | Description |
|------|------|:--------:|-------------|
| `transactionData` | string | ✓ | The transaction data to profile, as a base-64 encoded serialized `VersionedTransaction`. |
| `tag` | string | | An optional tag to identify the profiling results. Useful for grouping related transaction profiles. |
| `config` | object | | Configuration for the profile result. |
| `config.depth` | string | | Profiling depth: `transaction` for overall profile, `instruction` for per-instruction breakdown. |
| `config.encoding` | string | | Encoding format for returned account data (e.g., `base64`, `base58`, `jsonParsed`). |

### Result

| Field | Type | Description |
|-------|------|-------------|
| `context` | object | |
| `context.apiVersion` | string | The API version |
| `context.slot` | integer | The current slot |
| `value.computeUnits` | object | Compute units estimation result |
| `value.computeUnits.computeUnitsConsumed` | integer | Number of compute units consumed |
| `value.computeUnits.errorMessage` | string | Error message if estimation failed |
| `value.computeUnits.logMessages` | array | Log messages from the transaction |
| `value.computeUnits.success` | boolean | Whether the estimation was successful |
| `value.state` | object | Profile state containing pre and post execution states |
| `value.state.postExecution` | object | Account states after execution |
| `value.state.preExecution` | object | Account states before execution |

### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "surfnet_profileTransaction",
  "params": [
    "0x3b9aca00",
    "<some-tag>",
    {
      "depth": "instruction",
      "encoding": "base64"
    }
  ]
}
```

---

## `surfnet_getProfileResultsByTag`

Retrieves all profiling results for transactions tagged with a specific identifier.

### Parameters

| Name | Type | Required | Description |
|------|------|:--------:|-------------|
| `tag` | string | ✓ | The tag to retrieve profiling results for. |
| `config` | object | | Configuration for the profile result. |
| `config.depth` | string | | Profiling depth: `transaction` or `instruction`. |
| `config.encoding` | string | | Encoding format for returned account data. |

### Result

| Field | Type | Description |
|-------|------|-------------|
| `context.apiVersion` | string | The API version |
| `context.slot` | integer | The current slot |
| `value[]` | object | Array of `ProfileResultSchema` objects |
| `value[].computeUnits.computeUnitsConsumed` | integer | Number of compute units consumed |
| `value[].computeUnits.errorMessage` | string | Error message if estimation failed |
| `value[].computeUnits.logMessages` | array | Log messages from the transaction |
| `value[].computeUnits.success` | boolean | Whether the estimation was successful |
| `value[].state.postExecution` | object | Account states after execution |
| `value[].state.preExecution` | object | Account states before execution |

### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "surfnet_getProfileResultsByTag",
  "params": [
    "<some-tag>",
    {
      "depth": "instruction",
      "encoding": "base64"
    }
  ]
}
```

---

## `surfnet_setSupply`

Configures the network supply information including total, circulating, and non-circulating amounts.

### Parameters

| Name | Type | Required | Description |
|------|------|:--------:|-------------|
| `update` | object | ✓ | The supply data to update. |
| `update.circulating` | integer | | The new circulating supply of SOL in lamports. |
| `update.nonCirculating` | integer | | The new non-circulating supply of SOL in lamports. |
| `update.nonCirculatingAccounts` | array | | List of non-circulating account addresses that hold locked SOL. |
| `update.total` | integer | | The new total supply of SOL in lamports across the entire network. |

### Result

| Field | Type | Description |
|-------|------|-------------|
| `context.apiVersion` | string | The API version |
| `context.slot` | integer | The current slot |
| `value` | null | |

### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "surfnet_setSupply",
  "params": [
    {
      "circulating": 0,
      "nonCirculating": 0,
      "nonCirculatingAccounts": [],
      "total": 0
    }
  ]
}
```

---

## `surfnet_setProgramAuthority`

Sets or removes the upgrade authority for a program's `ProgramData` account.

### Parameters

| Name | Type | Required | Description |
|------|------|:--------:|-------------|
| `programId` | string | ✓ | The public key of the program, as a base-58 encoded string. |
| `newAuthority` | string | | The public key of the new authority. If omitted, the program becomes immutable (no upgrade authority). |

### Result

| Field | Type | Description |
|-------|------|-------------|
| `context.apiVersion` | string | The API version |
| `context.slot` | integer | The current slot |
| `value` | null | |

### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "surfnet_setProgramAuthority",
  "params": [
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "<some-newAuthority>"
  ]
}
```

---

## `surfnet_getTransactionProfile`

Retrieves the detailed profile of a specific transaction by signature or UUID.

### Parameters

| Name | Type | Required | Description |
|------|------|:--------:|-------------|
| `signatureOrUuid` | object | ✓ | The transaction signature (base-58 string) or UUID (string) identifying the transaction. |
| `config` | object | | Configuration for the profile result. |
| `config.depth` | string | | Profiling depth: `transaction` or `instruction`. |
| `config.encoding` | string | | Encoding format for returned account data. |

### Result

| Field | Type | Description |
|-------|------|-------------|
| `context.apiVersion` | string | The API version |
| `context.slot` | integer | The current slot |
| `value.instructionProfiles` | array | Per-instruction profile data |
| `value.key` | UuidOrSignature | Identifier for the profile |
| `value.readonlyAccountStates` | object | States of readonly accounts |
| `value.slot` | integer | Slot of the profiled transaction |
| `value.transactionProfile.accountStates` | object | Account states |
| `value.transactionProfile.computeUnitsConsumed` | integer | Compute units consumed |
| `value.transactionProfile.errorMessage` | string | Error message if failed |
| `value.transactionProfile.logMessages` | array | Log messages |

### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "surfnet_getTransactionProfile",
  "params": [
    { "uuid": "<some-uuid>" },
    {
      "depth": "instruction",
      "encoding": "base64"
    }
  ]
}
```

---

## `surfnet_registerIdl`

Registers an IDL (Interface Definition Language) for a program to enable account data parsing.

### Parameters

| Name | Type | Required | Description |
|------|------|:--------:|-------------|
| `idl` | object | ✓ | The full IDL object. The `address` field must match the program's public key. |
| `idl.accounts` | array | ✓ | Account types the program can create or interact with. |
| `idl.address` | string | ✓ | The program address this IDL describes, as a base-58 encoded string. |
| `idl.constants` | array | ✓ | Constant values used by the program. |
| `idl.errors` | array | ✓ | Custom error types the program can return. |
| `idl.events` | array | ✓ | Events the program can emit. |
| `idl.instructions` | array | ✓ | Available program instructions and their parameters. |
| `idl.metadata` | string | ✓ | Program name, version, and description. |
| `idl.state` | string | | The program's state account structure (if applicable). |
| `idl.types` | array | ✓ | Custom data types used by the program. |
| `slot` | integer | | The slot at which to register the IDL. Defaults to the latest slot. |

### Result

| Field | Type | Description |
|-------|------|-------------|
| `context.apiVersion` | string | The API version |
| `context.slot` | integer | The current slot |
| `value` | null | |

### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "surfnet_registerIdl",
  "params": [
    {
      "accounts": [],
      "address": "83astBRguLMdt2h5U1Tpdq5tjFoJ6noeGwaY3mDLVcri",
      "constants": [],
      "errors": [],
      "events": [],
      "instructions": [],
      "metadata": null,
      "state": null,
      "types": []
    },
    123456789
  ]
}
```

---

## `surfnet_getActiveIdl`

Retrieves the registered IDL for a specific program ID at a given slot.

### Parameters

| Name | Type | Required | Description |
|------|------|:--------:|-------------|
| `programId` | string | ✓ | The public key of the program, as a base-58 encoded string. |
| `slot` | integer | | The slot at which to query the IDL. Defaults to the latest slot. |

### Result

| Field | Type | Description |
|-------|------|-------------|
| `context.apiVersion` | string | The API version |
| `context.slot` | integer | The current slot |
| `value.accounts` | array | Account types the program can create or interact with |
| `value.address` | string | The program address, as a base-58 encoded string |
| `value.constants` | array | Constant values used by the program |
| `value.errors` | array | Custom error types the program can return |
| `value.events` | array | Events the program can emit |
| `value.instructions` | array | Available program instructions |
| `value.metadata` | any | Program name, version, and description |
| `value.state` | any | The program's state account structure |
| `value.types` | array | Custom data types used by the program |

### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "surfnet_getActiveIdl",
  "params": [
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    123456789
  ]
}
```

---

## `surfnet_getLocalSignatures`

Retrieves the most recent transaction signatures from the local network.

### Parameters

| Name | Type | Required | Description |
|------|------|:--------:|-------------|
| `limit` | integer | | Maximum number of signatures to return. Defaults to `50`. Returns most recent first. |

### Result

| Field | Type | Description |
|-------|------|-------------|
| `context.apiVersion` | string | The API version |
| `context.slot` | integer | The current slot |
| `value[]` | object | Array of `RpcLogsResponse` objects |
| `value[].err.errorType` | string | Error type |
| `value[].err.message` | string | Error message |
| `value[].logs` | array\<string\> | Log messages |
| `value[].signature` | string | Transaction signature |

### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "surfnet_getLocalSignatures",
  "params": [0]
}
```

---

## `surfnet_timeTravel`

Sets the network's current epoch info to a future time based on the supplied epoch, slot, or time.

### Parameters

| Name | Type | Required | Description |
|------|------|:--------:|-------------|
| `config` | string | | Configuration specifying how to modify the clock. Can move to a specific epoch, slot, or timestamp. |

### Result

| Field | Type | Description |
|-------|------|-------------|
| `absoluteSlot` | integer | Absolute root slot |
| `blockHeight` | integer | Block height |
| `epoch` | integer | Current epoch |
| `slotIndex` | integer | Current slot index within the epoch |
| `slotsInEpoch` | integer | Total number of slots in the epoch |
| `transactionCount` | integer | Current transaction count |

### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "surfnet_timeTravel",
  "params": [
    { "absoluteEpoch": 100 }
  ]
}
```

---

## `surfnet_pauseClock`

Pauses the local network's clock progression, halting block production.

### Result

| Field | Type | Description |
|-------|------|-------------|
| `absoluteSlot` | integer | Absolute root slot |
| `blockHeight` | integer | Block height |
| `epoch` | integer | Current epoch |
| `slotIndex` | integer | Current slot index within the epoch |
| `slotsInEpoch` | integer | Total number of slots in the epoch |
| `transactionCount` | integer | Current transaction count |

### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "surfnet_pauseClock",
  "params": []
}
```

---

## `surfnet_resumeClock`

Resumes the network's block production if paused.

### Result

| Field | Type | Description |
|-------|------|-------------|
| `absoluteSlot` | integer | Absolute root slot |
| `blockHeight` | integer | Block height |
| `epoch` | integer | Current epoch |
| `slotIndex` | integer | Current slot index within the epoch |
| `slotsInEpoch` | integer | Total number of slots in the epoch |
| `transactionCount` | integer | Current transaction count |

### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "surfnet_resumeClock",
  "params": []
}
```

---

## `surfnet_resetAccount`

Resets an account on the local network to its original state from the remote datasource.

### Parameters

| Name | Type | Required | Description |
|------|------|:--------:|-------------|
| `pubkey` | string | ✓ | The base-58 encoded public key of the account to reset. |
| `config` | object | | Configuration for the reset operation. |
| `config.includeOwnedAccounts` | boolean | | If `true`, also resets accounts owned by the specified account. |

### Result

| Field | Type | Description |
|-------|------|-------------|
| `context.apiVersion` | string | The API version |
| `context.slot` | integer | The current slot |
| `value` | null | |

### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "surfnet_resetAccount",
  "params": [
    "83astBRguLMdt2h5U1Tpdq5tjFoJ6noeGwaY3mDLVcri",
    { "includeOwnedAccounts": true }
  ]
}
```

---

## `surfnet_exportSnapshot`

Exports a snapshot of all accounts in the Surfnet SVM.

### Parameters

| Name | Type | Required | Description |
|------|------|:--------:|-------------|
| `config` | object | | Configuration for the export operation. |
| `config.includeParsedAccounts` | boolean | | If `true`, includes parsed account data in the snapshot. |
| `config.filter` | object | | Filter configuration to limit which accounts are included. |
| `config.filter.includeProgramAccounts` | boolean | | Whether to include program accounts. |
| `config.filter.includeAccounts` | array | | Specific account public keys to include. |
| `config.filter.excludeAccounts` | array | | Specific account public keys to exclude. |
| `config.scope` | string \| object | | `network` (all accounts) or `preTransaction` (accounts touched by a transaction). |

### Result

| Field | Type | Description |
|-------|------|-------------|
| `context.apiVersion` | string | The API version |
| `context.slot` | integer | The current slot |
| `value` | object | Map of account public keys to their snapshots |

### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "surfnet_exportSnapshot",
  "params": [
    {
      "includeParsedAccounts": true,
      "filter": {
        "includeProgramAccounts": true,
        "includeAccounts": [],
        "excludeAccounts": []
      },
      "scope": "network"
    }
  ]
}
```

---

## `surfnet_streamAccount`

Registers an account for streaming, downloading it from the datasource on every access rather than caching it in the SVM.

### Parameters

| Name | Type | Required | Description |
|------|------|:--------:|-------------|
| `pubkey` | string | ✓ | The base-58 encoded public key of the account to stream. |
| `config` | object | | Configuration for the stream operation. |
| `config.includeOwnedAccounts` | boolean | | If `true`, also streams accounts owned by the specified account. |

### Result

| Field | Type | Description |
|-------|------|-------------|
| `context.apiVersion` | string | The API version |
| `context.slot` | integer | The current slot |
| `value` | null | |

### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "surfnet_streamAccount",
  "params": [
    "83astBRguLMdt2h5U1Tpdq5tjFoJ6noeGwaY3mDLVcri",
    { "includeOwnedAccounts": true }
  ]
}
```

---

## `surfnet_streamAccounts`

Registers multiple accounts for streaming from the datasource in a single batch call. See also [`surfnet_streamAccount`](#surfnet_streamaccount).

### Parameters

| Name | Type | Required | Description |
|------|------|:--------:|-------------|
| `accounts` | array\<StreamAccountsEntry\> | ✓ | List of accounts to register for streaming. Each entry specifies a `pubkey` and an optional `includeOwnedAccounts` flag. |

### Result

| Field | Type | Description |
|-------|------|-------------|
| `context.apiVersion` | string | The API version |
| `context.slot` | integer | The current slot |
| `value` | null | |

### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "surfnet_streamAccounts",
  "params": [[]]
}
```

---

## `surfnet_offlineAccount`

Prevents an account (and optionally accounts it owns) from being downloaded from the remote RPC. See also [`surfnet_streamAccount`](#surfnet_streamaccount).

### Parameters

| Name | Type | Required | Description |
|------|------|:--------:|-------------|
| `pubkey` | string | ✓ | The base-58 encoded public key of the account or program to mark offline. |
| `config` | object | | Configuration for the offline operation. |
| `config.includeOwnedAccounts` | boolean | | If `true`, also marks accounts owned by the specified account as offline. |

### Result

| Field | Type | Description |
|-------|------|-------------|
| `context.apiVersion` | string | The API version |
| `context.slot` | integer | The current slot |
| `value` | null | |

### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "surfnet_offlineAccount",
  "params": [
    "83astBRguLMdt2h5U1Tpdq5tjFoJ6noeGwaY3mDLVcri",
    { "includeOwnedAccounts": true }
  ]
}
```

---

## `surfnet_writeProgram`

Writes program data at a specified offset, enabling deployment of large programs by sending data in chunks.

### Parameters

| Name | Type | Required | Description |
|------|------|:--------:|-------------|
| `programId` | string | ✓ | The public key of the program account, as a base-58 encoded string. |
| `data` | string | ✓ | Hex-encoded program data chunk to write. |
| `offset` | integer | ✓ | The byte offset at which to write this data chunk. |
| `authority` | string | | The base-58 encoded public key of the authority allowed to write. Defaults to the system program if omitted. |

### Result

| Field | Type | Description |
|-------|------|-------------|
| `context.apiVersion` | string | The API version |
| `context.slot` | integer | The current slot |
| `value` | null | |

### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "surfnet_writeProgram",
  "params": [
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "0x3b9aca00",
    0,
    "<some-authority>"
  ]
}
```

---

## `surfnet_registerScenario`

Registers a scenario with account overrides for testing different network states.

### Parameters

| Name | Type | Required | Description |
|------|------|:--------:|-------------|
| `scenario` | object | ✓ | The scenario object containing overrides. |
| `scenario.id` | string | ✓ | Unique identifier for the scenario. |
| `scenario.name` | string | ✓ | Human-readable name. |
| `scenario.description` | string | ✓ | Description of this scenario. |
| `scenario.overrides` | array\<OverrideInstance\> | ✓ | List of override instances in this scenario. |
| `scenario.tags` | array\<string\> | ✓ | Tags for categorization. |
| `slot` | integer | | The base slot from which relative slot offsets are calculated. Defaults to the current slot. |

### Result

| Field | Type | Description |
|-------|------|-------------|
| `context.apiVersion` | string | The API version |
| `context.slot` | integer | The current slot |
| `value` | null | |

### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "surfnet_registerScenario",
  "params": [
    {
      "id": "<some-id>",
      "name": "<some-name>",
      "description": "<some-description>",
      "overrides": [
        {
          "id": "<some-id>",
          "templateId": "<some-templateId>",
          "values": {},
          "scenarioRelativeSlot": 123456789,
          "label": "<some-label>",
          "enabled": true,
          "fetchBeforeUse": true,
          "account": {
            "pubkey": "83astBRguLMdt2h5U1Tpdq5tjFoJ6noeGwaY3mDLVcri"
          }
        }
      ],
      "tags": ["<some-tag>"]
    },
    123456789
  ]
}
```

---

## `surfnet_enableCheatcode`

Re-enables one or more previously disabled Surfpool cheatcode RPC methods for the current session. See also [`surfnet_disableCheatcode`](#surfnet_disablecheatcode).

### Parameters

| Name | Type | Required | Description |
|------|------|:--------:|-------------|
| `cheatcodesFilter` | string \| array | ✓ | Which cheatcodes to enable: either `"all"` or an explicit list of method names. |

### Result

| Field | Type | Description |
|-------|------|-------------|
| `context.apiVersion` | string | The API version |
| `context.slot` | integer | The current slot |
| `value` | null | |

### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "surfnet_enableCheatcode",
  "params": ["all"]
}
```

---

## `surfnet_disableCheatcode`

Disables one or more Surfpool cheatcode RPC methods for the current session. Without `lockout: true`, `surfnet_enableCheatcode` and `surfnet_disableCheatcode` themselves cannot be disabled. See also [`surfnet_enableCheatcode`](#surfnet_enablecheatcode).

### Parameters

| Name | Type | Required | Description |
|------|------|:--------:|-------------|
| `cheatcodesFilter` | string \| array | ✓ | Which cheatcodes to disable: either `"all"` or an explicit list of method names. |
| `config` | object | | Optional control config. |
| `config.lockout` | boolean | | If `true`, permits disabling `surfnet_enableCheatcode` and `surfnet_disableCheatcode` themselves, locking the cheatcode surface for the rest of the session. |

### Result

| Field | Type | Description |
|-------|------|-------------|
| `context.apiVersion` | string | The API version |
| `context.slot` | integer | The current slot |
| `value` | null | |

### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "surfnet_disableCheatcode",
  "params": [
    "all",
    { "lockout": true }
  ]
}
```

---

## `surfnet_resetNetwork`

Resets the entire network to its initial state.

### Result

| Field | Type | Description |
|-------|------|-------------|
| `context.apiVersion` | string | The API version |
| `context.slot` | integer | The current slot |
| `value` | null | |

### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "surfnet_resetNetwork",
  "params": []
}
```

---

## `surfnet_getStreamedAccounts`

Retrieves the list of accounts registered for streaming.

### Result

| Field | Type | Description |
|-------|------|-------------|
| `context.apiVersion` | string | The API version |
| `context.slot` | integer | The current slot |
| `value.accounts[]` | object | Array of `StreamedAccountInfoSchema` objects |
| `value.accounts[].pubkey` | string | Account public key as base-58 string |
| `value.accounts[].includeOwnedAccounts` | boolean | Whether owned accounts are also streamed |

### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "surfnet_getStreamedAccounts",
  "params": []
}
```

---

## `surfnet_getSurfnetInfo`

Retrieves Surfnet network information.

### Result

| Field | Type | Description |
|-------|------|-------------|
| `context.apiVersion` | string | The API version |
| `context.slot` | integer | The current slot |
| `value.runbookExecutions[]` | object | Array of `RunbookExecutionStatusSchema` objects |
| `value.runbookExecutions[].startedAt` | integer | Unix timestamp when execution started |
| `value.runbookExecutions[].completedAt` | integer | Unix timestamp when execution completed (`null` if still running) |
| `value.runbookExecutions[].runbookId` | string | Identifier of the runbook |
| `value.runbookExecutions[].errors` | array | Errors encountered during execution |

### Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "surfnet_getSurfnetInfo",
  "params": []
}
```
