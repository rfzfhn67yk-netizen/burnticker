// OPS-2 (2026-10-12): the per-client rate limit keys on the visitor, not the Cloudflare edge — CF-Connecting-IP is trusted ONLY when the
// address Caddy saw (the right-most X-Forwarded-For hop) is inside Cloudflare's published ranges; otherwise the socket address wins.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CLOUDFLARE_RANGES, clientKeyFromHeaders, isCloudflare, normalizeIp, bucketOf } from "@/lib/burnticker/api/clientIp";
import { clientKey, RateLimiter } from "@/lib/burnticker/api/http";

const h = (o: Record<string, string>) => new Headers(o);
const CF_EDGE = "172.70.1.2";          // inside 172.64.0.0/13
const CF_EDGE6 = "2606:4700:10::ac43:1";

describe("Cloudflare ranges", () => {
  test("the list is Cloudflare's published one (15 IPv4, 7 IPv6 ranges, checked 2026-10-12)", () => {
    assert.equal(CLOUDFLARE_RANGES.filter((r) => !r.includes(":")).length, 15);
    assert.equal(CLOUDFLARE_RANGES.filter((r) => r.includes(":")).length, 7);
    for (const r of ["173.245.48.0/20", "104.16.0.0/13", "172.64.0.0/13", "131.0.72.0/22", "2400:cb00::/32", "2a06:98c0::/29"]) assert.ok(CLOUDFLARE_RANGES.includes(r), r);
  });
  test("membership: edges inside, neighbours and private addresses outside", () => {
    for (const ip of [CF_EDGE, "104.16.0.1", "104.23.255.254", "162.159.0.1", "131.0.75.255", CF_EDGE6, "2a06:98c7:ffff::1", "::ffff:172.70.1.2"]) assert.ok(isCloudflare(ip), ip);
    for (const ip of ["104.15.255.255", "104.32.0.1", "172.72.0.1", "131.0.76.0", "127.0.0.1", "10.0.0.1", "203.0.113.9", "2a06:98c8::1", "2001:db8::1", "not-an-ip", ""]) assert.equal(isCloudflare(ip), false, ip);
  });
});

describe("clientKey", () => {
  test("from a Cloudflare edge: the visitor's CF-Connecting-IP", () => {
    assert.equal(clientKeyFromHeaders(h({ "x-forwarded-for": CF_EDGE, "cf-connecting-ip": "198.51.100.7" })), "198.51.100.7");
    // Caddy with trusted_proxies keeps the visitor's own header and appends the edge: still the edge is the right-most hop
    assert.equal(clientKeyFromHeaders(h({ "x-forwarded-for": `198.51.100.7, ${CF_EDGE}`, "cf-connecting-ip": "198.51.100.7" })), "198.51.100.7");
    assert.equal(clientKeyFromHeaders(h({ "x-forwarded-for": CF_EDGE6, "cf-connecting-ip": "198.51.100.8" })), "198.51.100.8");
  });
  test("two visitors behind the same edge get separate buckets", () => {
    const l = new RateLimiter({ read: { burst: 1, refillPerSec: 0.0001, human: "" }, heavy: { burst: 1, refillPerSec: 0.0001, human: "" }, write: { burst: 1, refillPerSec: 0.0001, human: "" } });
    const a = clientKey(new Request("http://x/", { headers: { "x-forwarded-for": CF_EDGE, "cf-connecting-ip": "198.51.100.1" } }));
    const b = clientKey(new Request("http://x/", { headers: { "x-forwarded-for": CF_EDGE, "cf-connecting-ip": "198.51.100.2" } }));
    assert.ok(l.take(a, "read", 0).ok); assert.equal(l.take(a, "read", 0).ok, false);
    assert.ok(l.take(b, "read", 0).ok, "the second visitor is not charged for the first");
  });
  test("NOT from Cloudflare: CF-Connecting-IP is ignored and the socket address is the key (a forged header picks no bucket)", () => {
    assert.equal(clientKeyFromHeaders(h({ "x-forwarded-for": "203.0.113.9", "cf-connecting-ip": "198.51.100.7" })), "203.0.113.9");
    // a visitor who writes a Cloudflare address into their own X-Forwarded-For: Caddy appends (or replaces with) the real peer
    assert.equal(clientKeyFromHeaders(h({ "x-forwarded-for": `${CF_EDGE}, 203.0.113.9`, "cf-connecting-ip": "198.51.100.7" })), "203.0.113.9");
    assert.equal(clientKeyFromHeaders(h({ "x-real-ip": "203.0.113.10", "cf-connecting-ip": "198.51.100.7" })), "203.0.113.10");
    assert.equal(clientKeyFromHeaders(h({ "cf-connecting-ip": "198.51.100.7" })), "direct", "no Caddy hop at all: the shared direct bucket");
  });
  test("a malformed CF-Connecting-IP from an edge falls back to the edge (never to a string the visitor wrote)", () => {
    assert.equal(clientKeyFromHeaders(h({ "x-forwarded-for": CF_EDGE, "cf-connecting-ip": "evil, 1.2.3.4" })), CF_EDGE);
    assert.equal(clientKeyFromHeaders(h({ "x-forwarded-for": CF_EDGE })), CF_EDGE);
  });
  test("IPv6 visitors are charged per /64; IPv4-mapped addresses read as IPv4", () => {
    assert.equal(clientKeyFromHeaders(h({ "x-forwarded-for": CF_EDGE, "cf-connecting-ip": "2001:db8:1:2:aaaa::1" })), "2001:db8:1:2::/64");
    assert.equal(clientKeyFromHeaders(h({ "x-forwarded-for": CF_EDGE, "cf-connecting-ip": "2001:db8:1:2:bbbb:cccc:dddd:eeee" })), "2001:db8:1:2::/64");
    assert.equal(clientKeyFromHeaders(h({ "x-forwarded-for": "2001:db8::5" })), "2001:db8:0:0::/64");
    assert.equal(bucketOf("2001:DB8:0001:0002::1".toLowerCase()), "2001:db8:1:2::/64");
    assert.equal(normalizeIp("::ffff:198.51.100.7"), "198.51.100.7");
    assert.equal(normalizeIp("[2001:db8::1]"), "2001:db8::1");
    assert.equal(normalizeIp("198.51.100.7:443"), null);
  });
  test("the existing behaviour without Cloudflare is unchanged: the right-most hop", () => {
    assert.equal(clientKey(new Request("http://x/", { headers: { "x-forwarded-for": "1.1.1.1, 203.0.113.9" } })), "203.0.113.9");
  });
});
