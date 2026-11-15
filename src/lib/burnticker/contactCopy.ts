/**
 * Sixth-pass audit OP6-11: the contact page's lines (src/app/burnticker/contact/page.tsx) and the API's JSON 404
 * (src/app/api/burnticker/[...missing]/route.ts). Kept here because a Next page or route file may export only its own fields.
 */
export const CONTACT_LINES = [
  "Questions about a coin, a receipt or this site: contact@burnticker.com.",
  "A security problem: security@burnticker.com. The bounty page says what is in scope and how reports are handled.",
  "The operator reads both addresses. Nobody from Burnticker ever asks for a wallet's recovery phrase or asks you to sign something by message.",
] as const;

export const API_NOT_FOUND = { ok: false, error: "There is no API route at this address. The routes are listed at /burnticker/docs and /api/burnticker/v1/openapi.json.", code: "not-found" } as const;
