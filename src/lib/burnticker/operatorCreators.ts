import TRANSPARENCY from "../../../config/burnticker/transparency.json" with { type: "json" };

/**
 * Eighth pre-launch audit B-24 / HB-186 / HS-72 (owner confirmed 2026-10-21): the operator's own wallet created seven soft-launch coins
 * through the site. The wallets come from config/burnticker/transparency.json `operatorCreatorWallets` (each also listed in `wallets`),
 * and any coin whose creator is one of them carries the sentence below on its page, so a later coin by the same wallet gets it too.
 */
export const OPERATOR_CREATOR_WALLETS: ReadonlySet<string> = new Set((TRANSPARENCY as { operatorCreatorWallets?: string[] }).operatorCreatorWallets ?? []);

/** The wallet as the disclosure writes it: its first four and last five characters ("8sJf…LvGbs"). */
export const operatorWalletShort = (a: string): string => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-5)}` : a);

/** The coin-page sentence for a coin the operator's own wallet created; null for any other creator. */
export function operatorCreatorLine(creator: string | null | undefined, wallets: ReadonlySet<string> = OPERATOR_CREATOR_WALLETS): string | null {
  if (!creator || !wallets.has(creator)) return null;
  return `Created by the operator's own wallet ${operatorWalletShort(creator)} during the soft launch. The operator holds none of it and has not traded it.`;
}
