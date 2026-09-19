# Source adapter contract

TrenchScan is moving from a Pump-only scanner to a launch-intelligence engine
with explicit source adapters.

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

Not yet claimed:

- live StonkFun feed
- literal first-buyer reconstruction
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

The same rule will apply to early buyers and creator history: we add a source
only when its evidence semantics are understood well enough to survive an
explorer check.
