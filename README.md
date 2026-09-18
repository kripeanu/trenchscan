# TrenchScan

**Fresh trenches. Less bullshit.**

TrenchScan is real-time Solana launch intelligence for trenchers: see fresh launches as they hit, read who is holding the bag, and follow the on-chain receipts before you ape.

Built for **Colosseum Crypto World's Fair 2026**.

## What works now

### Live trenches

TrenchScan subscribes directly to Solana and listens for Pump `create_v2` launches. Confirmed launches are decoded from the transaction and streamed to the UI over SSE.

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

## What comes next

The differentiating layer:

- **Same bankroll?** — wallet funding graph and shared-funder clusters
- **Dev baggage** — creator history and prior launches
- **Trench Brief** — plain-English, evidence-backed launch signals

No mystery AI risk score. If TrenchScan says something looks coordinated, the wallets and transactions should be right there.

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

`v0.3 — live launches + holder snapshot + who-aped-first replay`
