# Solana Test Validator Setup Guide

## Overview
This guide contains commands for setting up a local Solana test validator with various mainnet programs for testing purposes.

## Prerequisites
- Solana CLI installed
- `solana-test-validator` installed
- Local directory structure with `tests/programs/` folder

---

## 1. Downloading Programs from Mainnet

### Metaplex Token Metadata Program
```bash
solana program dump -u mainnet-beta \
  metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s \
  tests/programs/mpl-metadata.so
```

### Raydium CPMM Program
```bash
solana program dump -u mainnet-beta \
  CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C \
  tests/programs/raydium-cpmm.so
```

### Raydium AMM Program
```bash
solana program dump -u mainnet-beta \
  D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2 \
  tests/programs/raydium-amm.so
```

---

## 2. Running Test Validator with Single Program

### With Metaplex Token Metadata
```bash
solana-test-validator \
  --bpf-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s \
  tests/programs/mpl-metadata.so
```

### With Raydium CPMM
```bash
solana-test-validator \
  --bpf-program CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C \
  tests/programs/raydium-cpmm.so
```

---

## 3. Running Test Validator with Multiple Programs

### Metaplex + Raydium CPMM
```bash
solana-test-validator \
  --bpf-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s tests/programs/mpl-metadata.so \
  --bpf-program CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C tests/programs/raydium-cpmm.so
```

---

## 4. Cloning Programs and Accounts from Mainnet

### Clone Multiple Programs (Reset Validator)
```bash
solana-test-validator \
  --clone CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C \
  --clone D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2 \
  --clone DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8 \
  --url mainnet-beta \
  --reset
```

### Clone Single Account
```bash
solana-test-validator \
  --clone DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8 \
  --url mainnet-beta
```

### Clone Two Accounts
```bash
solana-test-validator \
  --clone D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2 \
  --clone DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8 \
  --url mainnet-beta
```

---

## 5. Hybrid Approach: Local Program + Cloned Accounts

### Local Raydium CPMM + Cloned Accounts
```bash
solana-test-validator \
  --bpf-program CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C tests/programs/raydium-cpmm.so \
  --clone D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2 \
  --clone DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8 \
  --url mainnet-beta
```

---

## Program Addresses Reference

| Program | Address |
|---------|---------|
| Metaplex Token Metadata | `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s` |
| Raydium CPMM | `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C` |
| Raydium AMM | `D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2` |
| Account to Clone | `DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8` |

---

## 🔍 Clone vs Local Download: Detailed Comparison

### **Clone Method (`--clone`)**

**How it works:**
- Directly copies accounts/programs from the network at runtime
- Creates an exact snapshot of the current on-chain state
- Requires internet connection during validator startup

**Advantages:**
✅ **Real-time state** - Gets the most current data from mainnet  
✅ **Complete account data** - Includes all associated accounts, data, and balances  
✅ **No storage needed** - Doesn't require saving `.so` files locally  
✅ **Quick setup** - Single command to get started  
✅ **Perfect state replication** - Exact copy including all program data accounts  

**Disadvantages:**
❌ **Internet required** - Must connect to RPC endpoint each time  
❌ **Slower startup** - Downloads data on each validator restart  
❌ **RPC rate limits** - May hit limits with many clones  
❌ **No offline testing** - Can't test without network access  

**Best for:**
- Testing with real mainnet data
- Debugging production issues
- Testing interactions with existing protocols
- Quick prototyping and experiments

### **Local Download Method (`--bpf-program`)**

**How it works:**
- Downloads program binary (`.so` file) once using `solana program dump`
- Loads the program from local file system
- No network access needed after initial download

**Advantages:**
✅ **Offline testing** - Works without internet after download  
✅ **Fast startup** - No network calls during validator start  
✅ **Version control** - Can commit `.so` files to git for reproducible tests  
✅ **Consistent environment** - Same program version across all tests  
✅ **No RPC limits** - Start/stop validator unlimited times  

**Disadvantages:**
❌ **No account data** - Only gets program code, not associated accounts  
❌ **Manual updates** - Must re-download for program updates  
❌ **Storage required** - `.so` files can be large (few MB each)  
❌ **Stale state** - Doesn't reflect latest on-chain changes  

**Best for:**
- CI/CD pipelines
- Offline development
- Reproducible test environments
- Testing specific program versions

---

## 📊 When to Use What: Decision Matrix

| Scenario | Recommended Method | Why |
|----------|-------------------|-----|
| **Testing DEX swaps with real liquidity pools** | `--clone` | Need actual pool states and balances |
| **Building a new program** | `--bpf-program` | Only need program code, not mainnet data |
| **Debugging mainnet transaction failure** | `--clone` | Need exact account states that caused the issue |
| **Running tests in CI/CD** | `--bpf-program` | Faster, offline, reproducible |
| **Testing NFT interactions** | Both | Clone NFT program + metadata accounts |
| **Development on airplane ✈️** | `--bpf-program` | Works offline |
| **Fork mainnet for testing** | `--clone` | Similar to Ethereum's fork feature |
| **Testing with specific oracle prices** | `--clone` | Get real oracle account data |

---

## 🎯 Hybrid Strategy (Recommended)

Combine both methods for optimal testing:

```bash
# Download programs for offline access
solana program dump -u mainnet-beta <PROGRAM_ID> tests/programs/program.so

# Clone important accounts with current state
solana-test-validator \
  --bpf-program <PROGRAM_ID> tests/programs/program.so \
  --clone <POOL_ACCOUNT> \
  --clone <ORACLE_ACCOUNT> \
  --url mainnet-beta
```

This gives you:
- ✅ Offline program access
- ✅ Current state for important accounts
- ✅ Best of both worlds

---

## Notes

- **`--bpf-program`**: Loads a program from a local `.so` file
- **`--clone`**: Clones an account or program directly from the specified network
- **`--url`**: Specifies the network to clone from (mainnet-beta, devnet, testnet)
- **`--reset`**: Resets the validator state before starting

## Tips for Testing

1. Use `--clone` for quick testing with mainnet state
2. Use `--bpf-program` with downloaded `.so` files for offline testing
3. Add `--reset` flag to start with a clean state
4. Combine both approaches for complex testing scenarios

---

## Troubleshooting

If you encounter issues:
1. Ensure the `tests/programs/` directory exists
2. Check that you have sufficient disk space for program dumps
3. Verify your Solana CLI is configured correctly: `solana config get`
4. Make sure the validator is not already running: `pkill solana-test-validator`