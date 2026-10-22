/**
 * THE FOOTER'S FEE ROW AS THE VISIBLE PAGES PRINT IT (HS-96). fees.ts DEV_FEE_LINE is the SDK-safe line (feeShareLine.ts and fees.ts are
 * in the SDK's public closure, which reads no config); this is that line plus the tier-pin sentence while the deployed mainnet burn
 * program is pre-B17 (deployedTierPin.ts, from config/burnticker/verified-build.json). The static shells (scripts/burnticker-site-nav.mts)
 * and the whitepaper print it; the app's SiteFooter builds the same line with the live tier14Live answer. Client-safe.
 */
import { BURNTICKER_DEV_FEE_BPS } from "@/lib/burnticker/fees";
import { footerFeeLine } from "@/lib/burnticker/feeShareLine";
import { DEPLOYED_TIER_PIN_PENDING } from "@/lib/burnticker/deployedTierPin";

export const FOOTER_FEE_LINE = footerFeeLine(BURNTICKER_DEV_FEE_BPS, { tier14Live: null, tierPinPending: DEPLOYED_TIER_PIN_PENDING });
