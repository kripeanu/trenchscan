# Verified StonkFun mainnet fixture

TrenchScan uses this receipt as the first pinned mainnet verification of the
StonkFun / Raydium LaunchLab adapter.

This is **not seeded demo token data**. The launch was located from the token's
own Solana transaction history, accepted only after the exact transaction
passed TrenchScan's LaunchLab + StonkFun attribution gates, then reproduced a
second time by exact transaction signature.

## Receipt

| Field | Value |
| --- | --- |
| Token | Raydium Rewards Mode |
| Symbol | RRM |
| Mint | `AC4EmomN4MSoTu4eYPKERgspY6LEoN6kHvETCG61STNK` |
| Signature | `36T8KBJ5nYvb7mnuZp4ApqPpzzHDYXDuYnewZadGe4GfBXasGwx2YdXG37WuAaLWUzU1Wa83dGVzYab9NP6AviUu` |
| Slot | `444274749` |
| LaunchLab variant | `initialize_with_token_2022` |
| Reward mode | `true` |
| Creator | `4cpwPB9cneyj5jJVLZtfz7pgFCUb8Ld1a3DmnrdpmAK4` |
| StonkFun platform config | `6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt` |
| Pool state | `9cjr5or3ovJRH1QUDLAamQVAfjmV8W2Ue5c2LJzXMGvu` |
| Base vault | `FXQrqRjgDNyvutcDWmemEBxtqTkN459dDRKBTNGCDabG` |
| Quote mint | `4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R` |

## What this proves

The exact transaction satisfied all source-attribution gates used by TrenchScan:

1. the instruction belongs to the Raydium LaunchLab program;
2. the instruction discriminator is a supported LaunchLab initialize variant;
3. account 3 is StonkFun's known reward-mode `platform_config`;
4. the decoded base mint is the RRM mint above;
5. exact-signature replay reproduced the same launch and returned HTTP 200.

## Holder-analysis result during verification

The source-aware analysis endpoint also returned HTTP 200, but Solana's public
RPC rate-limited the distribution method.

TrenchScan therefore returned:

- launch: `receipt`
- distribution: `rpc-blocked`
- distribution payload: `null`

That behavior is intentional. A missing holder read is not replaced with a
guessed concentration number.

A dedicated RPC will be used for the full LaunchLab holder-distribution
verification.
