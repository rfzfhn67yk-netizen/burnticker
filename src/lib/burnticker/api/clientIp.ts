import net from "node:net";

/**
 * WHO A REQUEST IS CHARGED TO (ops-2, 2026-10-12; docs/burnticker/LOADTEST.md "Finding"). The per-client rate limit (http.ts) used
 * the right-most X-Forwarded-For hop, the address our own Caddy appends: the machine that opened the TCP connection to Caddy. Behind
 * Cloudflare's proxy that machine is a Cloudflare edge server, so every visitor routed through one edge shared one bucket.
 *
 * The rule now:
 *   1. peer = the right-most X-Forwarded-For hop (Caddy appends the socket address it saw; a client cannot forge the right-most hop,
 *      because Caddy either replaces the header (untrusted peer) or appends to it (trusted_proxies)). No X-Forwarded-For: X-Real-IP,
 *      else the one shared "direct" bucket (a request that reached Next without Caddy, i.e. on the box's loopback).
 *   2. peer inside Cloudflare's published ranges (CLOUDFLARE_RANGES below) AND a well-formed CF-Connecting-IP → that address. Cloudflare
 *      sets CF-Connecting-IP itself on every proxied request and overwrites any value a visitor sends.
 *   3. otherwise the peer. A CF-Connecting-IP header from anywhere else is ignored, so a visitor who reaches the origin directly cannot
 *      choose their own bucket.
 *   4. an IPv6 client is charged per /64 (one home or phone line usually holds a whole /64 and can rotate inside it for free).
 *
 * The ranges are https://www.cloudflare.com/ips-v4 and /ips-v6, copied 2026-10-12. Cloudflare changes them rarely and announces it;
 * test/burntickerClientIp.test.ts pins this list, and docs/burnticker/OPS-EDGE.md has the one-line check the owner runs against the
 * live list.
 */
export const CLOUDFLARE_RANGES_CHECKED = "2026-10-12";
export const CLOUDFLARE_RANGES: readonly string[] = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20",
  "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
];

function blockList(ranges: readonly string[]): net.BlockList {
  const bl = new net.BlockList();
  for (const r of ranges) {
    const [addr, bits] = r.split("/");
    bl.addSubnet(addr, Number(bits), net.isIPv6(addr) ? "ipv6" : "ipv4");
  }
  return bl;
}
const CF = blockList(CLOUDFLARE_RANGES);

/** "::ffff:1.2.3.4" → "1.2.3.4"; brackets and an IPv6 zone are dropped; anything that is not an IP address → null. */
export function normalizeIp(raw: string | null | undefined): string | null {
  let s = (raw ?? "").trim();
  if (s.startsWith("[") && s.includes("]")) s = s.slice(1, s.indexOf("]"));
  const zone = s.indexOf("%"); if (zone > 0) s = s.slice(0, zone);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(s);
  if (mapped) s = mapped[1];
  return net.isIP(s) ? s.toLowerCase() : null;
}

export function isCloudflare(ip: string): boolean {
  const n = normalizeIp(ip);
  if (!n) return false;
  return CF.check(n, net.isIPv6(n) ? "ipv6" : "ipv4");
}

/** An IPv6 address → its /64 written as "<first four groups>::/64"; IPv4 unchanged. */
export function bucketOf(ip: string): string {
  if (!net.isIPv6(ip)) return ip;
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
  const groups = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return `${groups.slice(0, 4).map((g) => (parseInt(g || "0", 16) || 0).toString(16)).join(":")}::/64`;
}

/** The address Caddy saw (see 1. above), or null when the request did not come through Caddy. */
export function peerAddress(headers: Headers): string | null {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) { const hops = fwd.split(",").map((s) => s.trim()).filter(Boolean); if (hops.length) return hops[hops.length - 1]; }
  const real = headers.get("x-real-ip");
  return real ? real.trim() : null;
}

/** The client a request is charged to (rules 1 to 4 above). */
export function clientKeyFromHeaders(headers: Headers): string {
  const peer = peerAddress(headers);
  if (!peer) return "direct";
  const peerIp = normalizeIp(peer);
  if (peerIp && isCloudflare(peerIp)) {
    const visitor = normalizeIp(headers.get("cf-connecting-ip"));
    if (visitor) return bucketOf(visitor);
  }
  return peerIp ? bucketOf(peerIp) : peer;
}
