# Source adapter contract

TrenchScan is a multi-source launch-intelligence engine with explicit source
adapters.

The rule is simple: **shared plumbing is allowed; borrowed semantics are not.**

## Shared across launchpads

These primitives are source-neutral once the source adapter gives us the right
accounts:

- exact launch transaction receipt
- mint / creator / payer identity
- token supply
- largest token accounts
- protocol-inventory exclusion
- external-float concentration
- explorer receipts
- partial / blocked evidence coverage

## Pump

Verified / implemented today:

- live `create_v2` websocket ingestion
- Pump launch replay
- Pump bonding-curve inventory exclusion
- early curve-wallet replay
- exact-slot timing clues
- current retention of first decoded grabs
- funding graph
- sampled creator Pump-create history
- Trench Brief + proof pack

## StonkFun / Raydium LaunchLab

Implemented adapter contract:

- Raydium LaunchLab program verification
- known StonkFun `platform_config` verification
- `initialize_v2`
- `initialize_with_token_2022`
- MintParams decode
- payer / creator / pool / mint / quote mint / vault retention
- standard vs reward config
- source-aware holder distribution excluding the LaunchLab base vault
- exact-signature analysis API with partial coverage
- isolated live LaunchLab stream with strict StonkFun attribution
- LaunchLab `buy_exact_in` / `buy_exact_out` verification
- early-buyer rows requiring exact-pool buy instruction + positive payer token delta

Not yet claimed:

- literal first-buyer reconstruction when the bounded pool window cannot reach launch
- LaunchLab-specific funding graph semantics
- StonkFun creator-history interpretation
- a cross-launchpad composite risk score

## Why the boundary matters

A protocol-controlled token account can look exactly like a huge holder if the
scanner does not understand the source.

Pump's curve ATA and LaunchLab's base vault are different accounts with
different lifecycle semantics. TrenchScan makes each adapter declare which
inventory is protocol-controlled, then the shared distribution engine performs
the holder math.

The same rule now applies to early buyers: StonkFun buyers are derived from
LaunchLab buy instructions for the exact verified pool, then cross-checked
against payer token-balance deltas. Creator history is still source-gated until
its StonkFun semantics are understood well enough to survive an explorer check.

## Unified discovery, source-routed evidence

The browser consumes both live hubs through `/api/stream`. Every row is a
source-neutral `LaunchEnvelope`, globally sorted by observation time. The
single SCAN action then routes Pump envelopes to Pump evidence and StonkFun
envelopes to LaunchLab evidence.

This is deliberately a UX merge, not a semantic merge. A source can join live
discovery before every deeper analysis layer exists, but unsupported layers
must stay explicit and must never inherit another adapter's claims.
