# Colosseum demo runbook

This is the judge-safe TrenchScan demo path. Everything shown here is either
live on-chain data or an exact replay of a transaction TrenchScan previously
caught on Solana mainnet.

## The 90-second path

1. Open the dashboard and point out the **LISTENING** state.
2. Show **FRESH TRENCHES** populating from the shared Pump websocket listener.
3. Click **REPLAY VERIFIED TX** if you do not want the demo to depend on a launch
   arriving at that exact moment.
4. Explain that the replay transaction below was caught by TrenchScan during the
   mainnet runtime verification and is not seeded fake token data:
   - symbol at verification: `CATSEM`
   - mint: `GsmGN3fD3gPWitvFo9niEWgSsJAsJXtXiTua6KeUpump`
   - signature: `2G85yXGzDj9zr5RR3WTfyFExG7FR65ZK8rntp1gUYtTyMNG5STzDgGC43Qhsi8J2qQusYMvYf6DmUdC6rH4Hksq`
5. Walk left-to-right through **RECEIPT COVERAGE**. Never hide a blocked layer:
   `RECEIPT`, `DIGGING`, `NOT RUN`, and `RPC BLOCKED` mean exactly what
   they say.
6. Show **WHO APED FIRST?**, exact-slot timing, **WHO JEETED?**, **SAME
   BANKROLL?**, **MONEY TRAIL**, and **DEV BAGGAGE** as the RPC allows.
7. End on **TRENCH BRIEF** and open at least one explorer receipt.
8. Open **FULL JSON** or export the proof pack to show that the UI and
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
