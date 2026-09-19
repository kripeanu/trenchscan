import type { EarlyBuyerScan } from "./types";

export type SameSlotCluster = {
  slot: number;
  buyerCount: number;
  buyers: string[];
  signatures: string[];
  combinedSupplyPct: number | null;
  secondsAfterLaunch: number | null;
};

function sumKnown(values: Array<number | null>) {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}

/**
 * Groups decoded early wallets that received a positive token balance delta in
 * the exact same Solana slot.
 *
 * Same-slot activity is timing evidence only. It is not labeled a Jito bundle
 * or common-control cluster unless separate evidence proves that.
 */
export function buildSameSlotClusters(
  scan: EarlyBuyerScan | null,
): SameSlotCluster[] {
  if (!scan) return [];

  const bySlot = new Map<number, EarlyBuyerScan["buyers"]>();

  for (const buyer of scan.buyers) {
    const rows = bySlot.get(buyer.slot) ?? [];
    rows.push(buyer);
    bySlot.set(buyer.slot, rows);
  }

  return [...bySlot.entries()]
    .filter(([, buyers]) => buyers.length >= 2)
    .map(([slot, buyers]) => ({
      slot,
      buyerCount: buyers.length,
      buyers: buyers.map((buyer) => buyer.wallet),
      signatures: buyers.map((buyer) => buyer.signature),
      combinedSupplyPct: sumKnown(buyers.map((buyer) => buyer.supplyPct)),
      secondsAfterLaunch:
        buyers
          .map((buyer) => buyer.secondsAfterLaunch)
          .filter((value): value is number => value !== null)
          .sort((a, b) => a - b)[0] ?? null,
    }))
    .sort((left, right) => {
      if (right.buyerCount !== left.buyerCount) {
        return right.buyerCount - left.buyerCount;
      }

      return left.slot - right.slot;
    });
}
