// The public API's OpenAPI document (2026-10-09): generated from src/lib/burnticker/api/spec.ts — the same table the route wrapper
// reads its cache and rate-limit settings from. Structural validity (OpenAPI 3.1 / JSON Schema 2020-12 subset), every $ref resolving,
// path parameters declared both ways, unique operation ids, and the paths matching the route files on disk with the right methods.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildOpenApi, ENDPOINTS, SCHEMAS, API_VERSION, RATE_LIMITS } from "@/lib/burnticker/api/spec";

type O = Record<string, unknown>;
const doc = buildOpenApi() as O & { paths: Record<string, Record<string, O>>; components: { schemas: Record<string, O> }; info: O; openapi: string };
const METHODS = ["get", "post", "put", "patch", "delete"];
const TYPES = ["string", "number", "integer", "boolean", "object", "array", "null"];

function walk(node: unknown, at: string, visit: (n: O, at: string) => void): void {
  if (Array.isArray(node)) node.forEach((x, i) => walk(x, `${at}[${i}]`, visit));
  else if (node && typeof node === "object") { visit(node as O, at); for (const [k, v] of Object.entries(node)) walk(v, `${at}.${k}`, visit); }
}
const resolveRef = (ref: string): unknown => ref.replace(/^#\//, "").split("/").reduce<unknown>((o, k) => (o as O)?.[k], doc);

test("document header: OpenAPI 3.1.0, semver info.version, a server under /api/burnticker/v1, JSON-serialisable", () => {
  assert.equal(doc.openapi, "3.1.0");
  assert.match(String(doc.info.version), /^\d+\.\d+\.\d+$/); assert.equal(doc.info.version, API_VERSION);
  assert.ok(String(doc.info.title).length > 0);
  assert.equal((doc.servers as { url: string }[])[0].url, "/api/burnticker/v1");
  assert.deepEqual(JSON.parse(JSON.stringify(doc)), doc);
});

test("every $ref resolves; every schema keyword is well-formed (types, required ⊆ properties, items on arrays)", () => {
  walk(doc, "$", (n, at) => {
    if (typeof n.$ref === "string") { assert.match(n.$ref, /^#\/components\/schemas\/\w+$/, at); assert.ok(resolveRef(n.$ref), `${at}: ${n.$ref} resolves`); }
  });
  walk(doc.components.schemas, "#/components/schemas", (n, at) => {
    if (n.type !== undefined && !at.endsWith(".properties")) {
      const ts = Array.isArray(n.type) ? n.type : [n.type];
      for (const t of ts) assert.ok(TYPES.includes(t as string), `${at}: type ${String(t)}`);
      if (ts.includes("array") && !at.endsWith(".properties")) assert.ok(n.items, `${at}: array without items`);
    }
    if (Array.isArray(n.required) && n.properties) for (const r of n.required as string[]) assert.ok(r in (n.properties as O), `${at}: required ${r} is not a property`);
    if (n.pattern !== undefined) assert.doesNotThrow(() => new RegExp(n.pattern as string), at);
    if (n.enum !== undefined) assert.ok(Array.isArray(n.enum) && (n.enum as unknown[]).length > 0, `${at}: enum`);
  });
  for (const name of Object.keys(SCHEMAS)) assert.match(name, /^[A-Z]\w+$/);
});

test("operations: unique ids, documented 200 + errors with JSON schemas, request bodies only on POST, path parameters declared both ways", () => {
  const ids = new Set<string>();
  for (const [p, item] of Object.entries(doc.paths)) {
    assert.match(p, /^\/[\w.{}\/-]*$/);
    const templ = [...p.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [method, op] of Object.entries(item)) {
      assert.ok(METHODS.includes(method), `${p} ${method}`);
      const id = op.operationId as string;
      assert.ok(id && !ids.has(id), `${id} unique`); ids.add(id);
      const params = (op.parameters as { name: string; in: string; required: boolean; schema: O }[]);
      assert.deepEqual(params.filter((x) => x.in === "path").map((x) => x.name).sort(), templ, `${id}: path params`);
      for (const x of params) { assert.ok(["path", "query"].includes(x.in)); if (x.in === "path") assert.equal(x.required, true, `${id}.${x.name}`); assert.ok(x.schema, `${id}.${x.name} schema`); }
      const res = op.responses as Record<string, { description: string; content: { "application/json": { schema: O } } }>;
      assert.ok(res["200"]?.content["application/json"].schema, `${id}: 200`);
      for (const [code, r] of Object.entries(res)) { assert.match(code, /^[1-5]\d\d$/); assert.ok(r.description, `${id} ${code} description`); if (code !== "200") assert.deepEqual(r.content["application/json"].schema, { $ref: "#/components/schemas/Error" }); }
      assert.ok(res["429"], `${id}: every operation documents 429`);
      if (method === "post") { assert.ok(op.requestBody, `${id}: POST has a body`); assert.ok(res["403"] && res["415"], `${id}: POST documents the cross-site and content-type refusals`); }
      else assert.equal(op.requestBody, undefined, `${id}: GET has no body`);
      assert.equal(typeof op["x-cache-seconds"], "number"); assert.ok(Object.values(RATE_LIMITS).some((r) => r.human === op["x-rate-limit"]));
    }
  }
  assert.equal(ids.size, ENDPOINTS.length);
});

test("the document's paths are exactly the v1 route files on disk, each exporting the documented method", async () => {
  const root = path.resolve(import.meta.dirname, "../src/app/api/burnticker/v1");
  const onDisk: string[] = [];
  const scan = (dir: string, segs: string[]) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.isDirectory()) scan(path.join(dir, e.name), [...segs, e.name]); else if (e.name === "route.ts") onDisk.push(`/${segs.map((s) => s.replace(/^\[(\w+)\]$/, "{$1}")).join("/")}`); } };
  scan(root, []);
  assert.deepEqual(onDisk.sort(), Object.keys(doc.paths).sort());
  for (const [p, item] of Object.entries(doc.paths)) {
    const file = path.join(root, ...p.slice(1).split("/").map((s) => s.replace(/^\{(\w+)\}$/, "[$1]")), "route.ts");
    const mod = await import(file) as Record<string, unknown>;
    for (const m of Object.keys(item)) assert.equal(typeof mod[m.toUpperCase()], "function", `${p} exports ${m.toUpperCase()}`);
    for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE"]) if (typeof mod[m] === "function") assert.ok(m.toLowerCase() in item, `${p} exports an undocumented ${m}`);
  }
});
