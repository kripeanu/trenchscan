# Colosseum demo runbook

This is the judge-safe TrenchScan demo path. Everything shown here is either
live on-chain data or an exact replay of a transaction TrenchScan previously
caught on Solana mainnet.

## The 90-second path

1. Open the dashboard and point out the **2/2 SOURCES LIVE** state.
2. Show **FRESH TRENCHES** as one newest-first Pump + StonkFun feed.
3. Click **REPLAY VERIFIED TX** and **REPLAY STONKFUN TX** so the demo does not
   depend on either source printing at that exact moment.
4. Point out that both receipts land in the same table with different source
   badges, while the same **SCAN** action routes to different evidence engines.
5. Explain that the Pump replay transaction below was caught by TrenchScan during the
   mainnet runtime verification and is not seeded fake token data:
   - symbol at verification: `CATSEM`
   - mint: `GsmGN3fD3gPWitvFo9niEWgSsJAsJXtXiTua6KeUpump`
   - signature: `2G85yXGzDj9zr5RR3WTfyFExG7FR65ZK8rntp1gUYtTyMNG5STzDgGC43Qhsi8J2qQusYMvYf6DmUdC6rH4Hksq`
6. Walk left-to-right through Pump **RECEIPT COVERAGE**. Never hide a blocked layer:
   `RECEIPT`, `DIGGING`, `NOT RUN`, and `RPC BLOCKED` mean exactly what
   they say.
7. Show **WHO APED FIRST?**, exact-slot timing, **WHO JEETED?**, **SAME
   BANKROLL?**, **MONEY TRAIL**, and **DEV BAGGAGE** as the RPC allows.
8. Scan the StonkFun row and show its independent LaunchLab launch, bag-map and
   early-crew receipts. Call out that unsupported Pump-only layers are not shown.
9. End on **TRENCH BRIEF** and open at least one explorer receipt.
10. Open **FULL JSON** or export the proof pack to show that the UI and
   machine-readable result use the same evidence primitives.

## The pitch in one breath

> Fresh Solana launches move faster than the research tabs traders use to check
> them. TrenchScan catches the launch, reconstructs the early wallets, traces
> funding and creator history, and compresses the receipts into a five-second
> read without hiding the evidence behind a mystery score.

## What not to claim

- Same-slot activity is not automatically a Jito bundle.
- Shared funding is not proof of common ownership.
- A fresh-looking wallet is only fresh inside the bounded history we sampled.
- Prior creator launches are not automatically rugs.
- Who Jeeted is current balance versus first decoded grab, not a full PnL ledger.
- If a provider blocks a layer, show **RPC BLOCKED** instead of substituting a
  fake value.

## Demo fallback

The public Solana RPC can throttle expensive holder/history calls. That is why
the verified replay is deterministic and evidence layers degrade independently.
For the submitted live demo, use a dedicated RPC endpoint when available.
