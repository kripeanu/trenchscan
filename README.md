# TrenchScan

**Fresh trenches. Less bullshit.**

TrenchScan is real-time Solana launch intelligence for trenchers: see fresh launches as they hit, read who is holding the bag, and follow the on-chain receipts before you ape.

Built for **Colosseum Crypto World's Fair 2026**.

## What works now

### Live trenches

TrenchScan subscribes directly to Solana and listens for Pump `create_v2` launches. Confirmed launches are decoded from the transaction and streamed to the UI over SSE.

The live path now uses one shared launch hub per server process instead of opening a fresh Solana websocket subscription for every browser tab. The hub keeps the latest 80 decoded launches in memory and immediately backfills new SSE clients before continuing with live events.

That means:

- one Solana program subscription can fan out to many connected browsers
- a page refresh does not start from an empty feed while the server process stays alive
- RPC websocket load no longer scales linearly with open tabs
- initial subscription failures stay connected to the browser and retry with backoff

The feed does not use fake demo rows. If a token appears, TrenchScan observed it on-chain.

### Trench snapshot

Click **SCAN** on a launch to get an evidence-backed distribution read:

- biggest external bag
- top-10 external concentration
- supply "in the wild"
- Pump bonding-curve stash
- creator/dev bag when the creator is in the sampled top accounts
- top external token accounts with one-click explorer receipts

The Pump bonding-curve inventory is deliberately excluded from whale concentration math. We do not want protocol-controlled inventory mislabeled as a whale.

### Who aped first?

The scan also replays the earliest Pump bonding-curve transactions it can reach from RPC and extracts wallets whose token balance increased.

For each decoded early wallet TrenchScan shows:

- wallet + explorer receipt
- tokens grabbed
- share of supply
- time after the launch slot
- creator/dev tag when applicable

The replay is deliberately bounded. If RPC history does not reach the launch boundary, the UI says **PARTIAL WINDOW** instead of pretending those wallets were literally first.

### Same-slot crew

The early-buyer replay also groups wallets that received positive token balance deltas in the **exact same Solana slot**.

For each cluster TrenchScan shows:

- slot number
- wallet count
- combined decoded supply share
- timing after launch
- the wallets involved, with explorer links

This is deliberately called a **timing clue**, not a Jito bundle detector. Same-slot activity can come from bots, organic competition, or coordinated actors, so TrenchScan does not upgrade it into a stronger claim without separate evidence.

The largest exact-slot cluster is also surfaced in the Trench Brief as **SAME SLOT?**.

### Who jeeted?

From the decoded early-wallet set, TrenchScan can compare each wallet's first positive token delta with what that wallet holds **now**.

For up to 12 early wallets the read shows:

- the first decoded grab
- current token balance
- retention percentage
- whether the wallet **JEETED**, **MOSTLY JEETED**, **TRIMMED**, **STILL HOLDING**, or **ADDED**

The retention signal is deliberately narrow: it answers **"how much of that first decoded grab is still in this wallet?"** It is not a full trade ledger or PnL calculation, because a wallet may buy and sell again later.

This evidence also feeds the Trench Brief. A launch where several early wallets already dumped most of their first grab is surfaced explicitly instead of being hidden inside holder concentration.

### Same bankroll?

From the early-buyer set, TrenchScan can run an on-demand wallet fingerprint + funding pass for up to 12 wallets.

The pass now shows:

- bounded pre-buy wallet history, including wallets with no prior sampled history or histories starting within 1h / 24h of the first decoded buy
- most recent direct native-SOL funder before launch
- shared direct-funder clusters
- one additional upstream funding hop
- upstream families where different direct funders trace back to the same source
- SOL amounts, timing and explorer receipts

This is deliberately evidence-first. A fresh-looking wallet is based on bounded sampled history, not a claim that an address has never existed before. A shared direct or upstream funder is a **clue, not proof of common control**; CEX hot wallets and payout services can connect unrelated traders.

The same evidence now feeds a visual **MONEY TRAIL** map: upstream source → direct funder → early buyer. Nodes open in Solscan and the underlying funding receipts remain directly below the graph, so the visualization never replaces the evidence.

### Dev baggage

TrenchScan can also sample the creator wallet's recent history immediately before the current launch and look for prior Pump `create_v2` transactions by that same creator.

It shows:

- prior token name + ticker
- mint
- launch receipt
- launch time when RPC provides it
- Mayhem mode where applicable

The current pass samples the 60 creator-wallet signatures immediately before launch. If no prior creates are found, TrenchScan says exactly that — it does **not** claim the wallet is a first-time dev. It also does not label prior launches as rugs without separate evidence.

### Trench Brief

The token panel now synthesizes the layers above into a compact evidence brief. It combines holder distribution, decoded early-wallet concentration/timing, shared direct funders when traced, creator history when sampled, and creator bag size.

The brief uses explicit threshold rules and visible evidence — **not a hidden composite score**. It can say things such as **KEEP BOTH EYES OPEN**, **MULTIPLE RED FLAGS**, or **MORE RECEIPTS NEEDED**, then shows exactly which observations produced that read.

If relationship checks have not been run yet, the brief says so instead of filling the gaps with guesses.

### Real-launch replay

The homepage also has **REPLAY REAL LAUNCH** for development, demos and judging. It asks Solana RPC for recent Pump program history, finds a real decodable `create_v2` launch, drops that historical launch into the same UI, and immediately runs the normal TrenchScan pipeline.

This is not seeded fake data. Replay uses:

- a real Pump transaction
- the same launch decoder as the websocket listener
- the same holder snapshot endpoint
- the same who-aped-first replay
- the same optional funding + dev-history checks

The replay API also accepts an exact transaction signature so a known launch can be reproduced later.

Replay links are now shareable with `?replay=<transaction-signature>`. Opening one automatically loads that real transaction into TrenchScan, which makes a judge/demo flow reproducible instead of relying on whatever launches happen to appear live.

Inside the token scan, **RUN FULL RECEIPT PASS** runs the optional evidence checks together once the early-buyer replay is ready:

- Who Jeeted current-balance retention
- Same Bankroll direct/upstream funding trace
- Dev Baggage creator-history scan

The individual controls remain available, but the one-click pass is the faster demo path.

### Share + proof pack

The Trench Brief can now be copied as compact trench-native text with the replay URL attached. The same panel can export a versioned JSON proof pack containing the launch, holder snapshot, early-buyer replay, funding relationships, dev history, derived brief, explorer receipt links and explicit limitations.

That means a result can be shared without hiding how TrenchScan got there.

## What comes next

- stronger dev history context without inventing "rug" labels
- launchpad adapter work after the Pump v1 path is runtime-verified
- additional Solana launchpads after the Pump v1 path is stable

No mystery AI risk score. If TrenchScan says something looks coordinated, the wallets and transactions should be right there.

## Tests

The deterministic signal layer has unit coverage for Trench Brief escalation rules and shared-direct-funder clustering. CI now runs typecheck, tests and a production build on every PR.

## Stack

- Next.js + TypeScript
- Solana RPC + WebSocket subscriptions
- `@solana/web3.js`
- Pump's public `create_v2` instruction format
- Server-Sent Events for the live browser feed

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

For development the app can fall back to Solana's public endpoint. For sustained live use, set `SOLANA_RPC_URL` (and optionally `SOLANA_WS_URL`) to a dedicated provider.

Then open `http://localhost:3000`.

## Principles

- **Chain first.** The signal starts with verifiable on-chain data.
- **Fast enough to matter.** Built for the first minutes, not the post-mortem.
- **Receipts visible.** Let the trader verify every meaningful claim.
- **Trencher language.** Less jargon, faster reads.
- **No fake demo data.** The demo should survive being checked against an explorer.

## Status

`v0.15 — exact-slot early activity + Who Jeeted retention`
