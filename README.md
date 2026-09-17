# TrenchScan

**Scan first. Ape second.**

TrenchScan is a real-time Solana scanner for degenerates with questionable risk tolerance. It tears apart fresh microcaps and turns messy on-chain activity into fast, explainable signals.

Built for **Colosseum Crypto World's Fair 2026**.

## The idea

Fresh Solana launches move faster than the tools people use to understand them. Traders end up bouncing between explorers, wallet trackers, scanners and Telegram bots while the token changes underneath them.

TrenchScan is being built as one terminal for the first minutes of a launch: what launched, who created it, who got in early, which wallets are connected, how concentrated ownership is, and what on-chain patterns deserve attention.

No mystery AI scores. If TrenchScan calls something suspicious, the evidence should be visible.

## v0.1 — live launch feed

The first milestone is intentionally narrow and real:

1. subscribe directly to the official Pump program on Solana
2. detect confirmed `create_v2` instructions
3. fetch the transaction from RPC
4. decode Pump's published instruction layout
5. stream verified launch data to the browser over SSE

The UI shows only fields decoded from chain data: token name/symbol, mint, creator, mayhem mode, transaction and age.

## Roadmap

- creator / dev launch history
- first-buyer and early-supply analysis
- holder concentration
- wallet funding graph + clusters
- coordinated launch activity
- evidence-backed launch briefs
- alerts and filters for the trenches

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

Then open `http://localhost:3000` and wait for the next confirmed Pump launch.

## Principles

- **Chain first.** Detection and analysis should come from verifiable on-chain data.
- **Fast enough to matter.** The product is for the first minutes of a launch, not a post-mortem.
- **Explain the signal.** Show the wallets, transactions and relationships behind a warning.
- **No fake demo data.** A hackathon demo should survive being checked against an explorer.

## Status

`v0.1 — live launch feed under verification`
