/**
 * AN ERROR'S TEXT, SAFE TO ECHO (review 2026-10-15 item 6). The launch routes answered "The reason given was: <e.message>", and an RPC
 * or upstream error message can carry its endpoint, sometimes with an API key in the path or the query string. Every echoed error text
 * goes through here: web addresses become "[address hidden]", key-like query parameters are dropped, and the text is cut to `max`.
 */
export function safeErrorText(e: unknown, max = 160): string {
  const raw = String((e as Error)?.message ?? e ?? "");
  return raw
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)]+/gi, "[address hidden]")
    .replace(/\b[a-z0-9-]+(\.[a-z0-9-]+)+\/[^\s"'<>)]*\?[^\s"'<>)]*/gi, "[address hidden]")
    .replace(/[?&][a-z0-9_-]*(key|token|secret|auth|signature)[a-z0-9_-]*=[^\s&"'<>)]*/gi, "")
    .replace(/\b(api[-_]?key|token|secret)\s*[:=]\s*\S+/gi, "$1 [hidden]")
    .slice(0, max);
}
