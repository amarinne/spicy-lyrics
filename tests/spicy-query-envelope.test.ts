import assert from "node:assert/strict";
import { after, test } from "node:test";

// Query's module graph touches `window` (Global.ts, stores.ts) and the
// breaker's persisted store reads localStorage at import; shim both before the
// dynamic import. Math.random is pinned so jittered trips land exactly on a
// ladder rung.
const backing = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => void backing.set(key, value),
    removeItem: (key: string) => void backing.delete(key),
    clear: () => void backing.clear(),
  },
});
Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
Object.defineProperty(globalThis, "Spicetify", {
  configurable: true,
  value: { LocalStorage: { get: () => null, set: () => {} } },
});
Math.random = () => 0.5;

const { BreakerDebug } = await import("../src/utils/API/CircuitBreaker.ts");
const { Query, QueryHttpError, QueryNetworkError } = await import("../src/utils/API/Query.ts");

const QUERY_URL = "https://api.spicylyrics.org/query";

const realFetch = globalThis.fetch;
let handler: () => Response | Promise<Response>;
let lastUrl = "";
let lastInit: RequestInit | undefined;
globalThis.fetch = (async (url: any, init: any) => {
  lastUrl = String(url);
  lastInit = init;
  return handler();
}) as any;
after(() => {
  globalThis.fetch = realFetch;
});

const NOTICE_ENVELOPE = [
  { _notice: "Access is granted solely for personal, individual use through official Spicy Lyrics clients." },
  { operation: "lyrics", operationId: "0", result: { data: { Type: "Line", Content: [] }, httpStatus: 200, format: "json" } },
];

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

test("server notice entry no longer hides the real query result", async () => {
  BreakerDebug.reset();
  handler = () => jsonResponse(200, { queries: NOTICE_ENVELOPE });
  const result = (await Query([{ operation: "lyrics" }])).get("0");
  assert.equal(result?.httpStatus, 200);
  assert.ok(result?.data);
});

test("legacy single-entry envelopes keep working", async () => {
  BreakerDebug.reset();
  handler = () => jsonResponse(200, { queries: [{ operationId: "0", result: { data: { error: "Spotify API error" }, httpStatus: 429, format: "json" } }] });
  const result = (await Query([{ operation: "lyrics" }])).get("0");
  assert.equal(result?.httpStatus, 429);
});

test("a notice-only envelope yields no result, read as lyrics-not-found upstream", async () => {
  BreakerDebug.reset();
  handler = () => jsonResponse(200, { queries: [{ _notice: "policy text" }] });
  const result = (await Query([{ operation: "lyrics" }])).get("0");
  assert.equal(result, undefined);
});

test("requests carry the official 6.3.20 wire contract", async () => {
  BreakerDebug.reset();
  handler = () => jsonResponse(200, { queries: NOTICE_ENVELOPE });
  const queries = [{ operation: "lyrics", variables: { id: "id1", auth: "SpicyLyrics-WebAuth" } }];
  await Query(queries, { "SpicyLyrics-WebAuth": "Bearer secret" });
  assert.equal(lastUrl, QUERY_URL);
  const headers = new Headers(lastInit!.headers);
  assert.equal(headers.get("Content-Type"), "application/json");
  assert.equal(headers.get("SpicyLyrics-Version"), "6.3.20");
  assert.equal(headers.get("X-mode"), "2");
  assert.equal(headers.get("SpicyLyrics-WebAuth"), "Bearer secret");
  assert.equal(lastInit!.method, "POST");
  assert.deepEqual(JSON.parse(String(lastInit!.body)), { queries, client: { version: "6.3.20" } });
});

test("a transport 429 honors Retry-After and counts against the breaker", async () => {
  BreakerDebug.reset();
  handler = () => jsonResponse(429, {}, { "Retry-After": "120" });
  await assert.rejects(() => Query([{ operation: "lyrics" }]), (error: unknown) =>
    error instanceof QueryHttpError && error.status === 429 && error.retryAfterMs === 120_000);
  assert.equal(BreakerDebug.state().open, false);
  await assert.rejects(() => Query([{ operation: "lyrics" }]), QueryHttpError);
  const state = BreakerDebug.state();
  assert.equal(state.open, true);
  assert.ok(state.retryAfterMs > 119_000 && state.retryAfterMs <= 120_000);
});

test("a transport 403 trips the breaker on the ladder rung", async () => {
  BreakerDebug.reset();
  handler = () => jsonResponse(403, {});
  await assert.rejects(() => Query([{ operation: "lyrics" }]), (error: unknown) => error instanceof QueryHttpError && error.status === 403);
  await assert.rejects(() => Query([{ operation: "lyrics" }]), QueryHttpError);
  const state = BreakerDebug.state();
  assert.equal(state.open, true);
  // Trip time vs assert time can straddle a millisecond of real clock.
  assert.ok(state.retryAfterMs > 29_000 && state.retryAfterMs <= 30_000);
});

test("a transport 401 is a plain error and never counts against the breaker", async () => {
  BreakerDebug.reset();
  handler = () => jsonResponse(401, {});
  for (let i = 0; i < 3; i++) {
    await assert.rejects(() => Query([{ operation: "lyrics" }]), (error: unknown) => error instanceof QueryHttpError && error.status === 401);
  }
  assert.equal(BreakerDebug.state().open, false);
});

test("a fetch that never produces a response becomes QueryNetworkError and counts against the breaker", async () => {
  BreakerDebug.reset();
  handler = () => { throw new TypeError("blocked by CORS"); };
  await assert.rejects(() => Query([{ operation: "lyrics" }]), QueryNetworkError);
  assert.equal(BreakerDebug.state().open, false);
  await assert.rejects(() => Query([{ operation: "lyrics" }]), QueryNetworkError);
  assert.equal(BreakerDebug.state().open, true);
});
