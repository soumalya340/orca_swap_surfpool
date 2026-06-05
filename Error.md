Right now, the test is failing with InvalidTimestamp (6022) because:

### 1. The Real Mainnet State

The pools you are swapping against (SOL/WBTC and SOL/WETH) are standard pools. On Mainnet, they do
not use oracles. Because they don't use oracles, their oracle PDA accounts are completely empty (0
data bytes) and uninitialized.

### 2. What Surfpool Does (The Bug)

When you run the test against Surfpool, it intercept the oracle accounts you pass. Because it is in
online-forking mode:

1. Surfpool queries Mainnet to see if the oracle accounts exist.
2. Mainnet responds that they are empty/uninitialized.
3. Instead of keeping them empty, Surfpool materializes (creates) the accounts locally but leaves
   them with zeroed-out/stale data.

### 3. Why the Orca Program Rejects It

During the swap, the Orca program executes on Surfpool and inspects the oracle accounts:

1. Orca sees that the oracle accounts exist locally on Surfpool.
2. It parses the data inside them and reads the oracle timestamp (which is zero or extremely old).
3. It compares this stale timestamp with Surfpool's current local clock.
4. Because the timestamps don't match, Orca throws the InvalidTimestamp (6022) error and aborts the
   swap.

### 4. Why We Need to Wipe Them

If the oracle accounts are wiped (reset to empty, length 0, owner = System Program):

1. Orca will inspect the oracle accounts and see they have 0 data length.
2. Orca realizes: "Ah, these pools don't use oracles, they are uninitialized."
3. Orca skips the timestamp check completely, and the swap succeeds.

──────

### Solution A: The Setup Script Workflow

We create a helper script scripts/wipe-oracles.ts that uses Surfpool's JSON-RPC to wipe the oracle
accounts once.

#### Step 1: Create the script scripts/wipe-oracles.ts

We create a file containing this code:

    import { Connection, PublicKey } from "@solana/web3.js";

    const connection = new Connection("http://127.0.0.1:8899", "confirmed");
    const WHIRLPOOL_PROGRAM_ID = new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
    const WSOL_WBTC_POOL = new PublicKey("B5EwJVDuAauzUEEdwvbuXzbFFgEYnUqqS37TUM1c4PQA");
    const WSOL_WETH_POOL = new PublicKey("HktfL7iwGKT5QHjywQkcDnZXScoh811k7akrMZJkCcEF");

    function findOraclePda(pool: PublicKey): PublicKey {
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("oracle"), pool.toBuffer()],
        WHIRLPOOL_PROGRAM_ID,
      );
      return pda;
    }

    async function main() {
      console.log("🧹 Wiping oracle accounts on Surfpool to prevent InvalidTimestamp...");
      const wbtcOracle = findOraclePda(WSOL_WBTC_POOL);
      const wethOracle = findOraclePda(WSOL_WETH_POOL);

      for (const oracle of [wbtcOracle, wethOracle]) {
        const info = await connection.getAccountInfo(oracle);
        if (info && info.data.length > 0) {
          console.log(`   Wiping oracle account: ${oracle.toBase58()}`);
          // Send raw surfnet_setAccount RPC call to the running Surfpool validator
          await (connection as any)._rpcRequest("surfnet_setAccount", [
            oracle.toBase58(),
            {
              lamports: 0,
              data: "",
              owner: "11111111111111111111111111111111",
              executable: false,
            },
          ]);
        } else {
          console.log(`   Oracle account ${oracle.toBase58()} is already empty.`);
        }
      }
      console.log("✅ Oracle accounts wiped successfully!");
    }

    main().catch((err) => {
      console.error("❌ Failed to wipe oracle accounts:", err);
      process.exit(1);
    });

#### Step 2: Add it to package.json

We can add a script to run this easily:

    "wipe:oracles": "ts-node scripts/wipe-oracles.ts"

#### Step 3: Run the tests

Whenever you start Surfpool, you run the wipe script once:

    yarn wipe:oracles

And then run your test as usual:

    yarn test:orca --skip-deploy

Because Surfpool keeps its state in memory, once the oracles are wiped by the script, your tests will
pass continuously until you restart the Surfpool validator.
──────

### Request for Permission

May I create the scripts/wipe-oracles.ts file and add the "wipe:oracles" script to your
package.json?
