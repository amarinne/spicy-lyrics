import assert from "node:assert/strict";
import { test } from "node:test";

// The breaker persists through GetInstantStore, which reads localStorage at
// import; shim it (Map-backed) before the dynamic import. Date and Math.random
// are pinned so trip windows and jitter are deterministic: jitter(ms, 0.5)
// with rand pinned at 0.5 lands exactly on ms.
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
Object.defineProperty(globalThis, "Spicetify", {
  configurable: true,
  value: { LocalStorage: { get: () => null, set: () => {} } },
});
Object.defineProperty(globalThis, "window", { configurable: true, value: {} });

const realNow = Date.now;
let now = realNow();
Date.now = () => now;
const advance = (ms: number) => { now += ms; };
Math.random = () => 0.5;

const { Acquire, BreakerDebug, IsOpen, IsTripStatus, ParseRetryAfter, ServiceUnavailableError, SettleFailure, SettleSuccess } = await import("../src/utils/API/CircuitBreaker.ts");

// Leases shared across the story tests: the stale-probe test grants two user
// probes; the closer test settles the surviving one.
let staleProbeFirst: any;
let staleProbeAgain: any;

test("two consecutive transport failures trip the breaker on the first rung", () => {
  BreakerDebug.reset();
  SettleFailure(Acquire(false));
  assert.equal(IsOpen(), false);
  SettleFailure(Acquire(false));
  assert.equal(IsOpen(), true);
  const state = BreakerDebug.state();
  assert.equal(state.ladderIndex, 1);
  assert.ok(state.retryAfterMs > 29_000 && state.retryAfterMs <= 30_000);
  const persisted = JSON.parse(backing.get("SpicyLyrics_QueryBreaker_g1")!);
  assert.ok(persisted.Items.openUntil > now);
});

test("an open breaker suppresses background traffic but grants a user probe", () => {
  assert.throws(() => Acquire(false), (error: unknown) => error instanceof ServiceUnavailableError && error.retryAfterMs > 0);
  const probe = Acquire(true);
  assert.equal(probe.kind, "earlyProbe");
  SettleFailure(probe);
  assert.equal(BreakerDebug.state().ladderIndex, 1);
  assert.ok(BreakerDebug.state().retryAfterMs > 29_000 && BreakerDebug.state().retryAfterMs <= 30_000);
  assert.throws(() => Acquire(true), ServiceUnavailableError);
});

test("the window elapses into a half-open health check; failing it re-trips up the ladder", () => {
  advance(31_000);
  const halfOpen = Acquire(false);
  assert.equal(halfOpen.kind, "halfOpen");
  SettleFailure(halfOpen);
  assert.equal(BreakerDebug.state().ladderIndex, 2);
  assert.ok(BreakerDebug.state().retryAfterMs > 29_000 && BreakerDebug.state().retryAfterMs <= 30_000);
});

test("stale probes release their slot and their settle is ignored", () => {
  // Walk the 30s head of the ladder up to the first 120s rung: half-open
  // failures re-trip one rung further each time the window elapses.
  advance(31_000);
  SettleFailure(Acquire(false));
  assert.equal(BreakerDebug.state().ladderIndex, 3);
  advance(31_000);
  SettleFailure(Acquire(false));
  assert.equal(BreakerDebug.state().ladderIndex, 4);
  assert.ok(BreakerDebug.state().retryAfterMs > 59_000 && BreakerDebug.state().retryAfterMs <= 60_000);
  advance(61_000);
  SettleFailure(Acquire(false));
  assert.equal(BreakerDebug.state().ladderIndex, 5);
  assert.ok(BreakerDebug.state().retryAfterMs > 119_000 && BreakerDebug.state().retryAfterMs <= 120_000);
  // The half-open grants above also refresh the probe timestamp, so a user
  // probe waits out its own cooldown after the re-trip.
  advance(31_000);
  staleProbeFirst = Acquire(true);
  assert.equal(staleProbeFirst.kind, "earlyProbe");
  advance(61_000);
  staleProbeAgain = Acquire(true);
  assert.equal(staleProbeAgain.kind, "earlyProbe");
  assert.notEqual(staleProbeAgain.probeToken, staleProbeFirst.probeToken);
  SettleFailure(staleProbeFirst);
  assert.equal(BreakerDebug.state().ladderIndex, 5);
});

test("a successful probe closes the breaker and resets the ladder", () => {
  SettleSuccess(staleProbeAgain);
  assert.equal(IsOpen(), false);
  const state = BreakerDebug.state();
  assert.equal(state.openUntil, 0);
  assert.equal(state.ladderIndex, 0);
});

test("a Retry-After header overrides the ladder and a huge one is clamped", () => {
  SettleFailure(Acquire(false));
  SettleFailure(Acquire(false), 90_000);
  assert.ok(BreakerDebug.state().retryAfterMs > 89_000 && BreakerDebug.state().retryAfterMs <= 90_000);
  advance(91_000);
  const halfOpen = Acquire(false);
  assert.equal(halfOpen.kind, "halfOpen");
  SettleFailure(halfOpen, 10_000_000);
  assert.ok(BreakerDebug.state().retryAfterMs > 2_699_000 && BreakerDebug.state().retryAfterMs <= 2_700_000);
});

test("a success between failures resets the consecutive count", () => {
  BreakerDebug.reset();
  SettleFailure(Acquire(false));
  SettleSuccess(Acquire(false));
  SettleFailure(Acquire(false));
  assert.equal(IsOpen(), false);
});

test("ParseRetryAfter accepts delta-seconds and HTTP-dates, ignoring the rest", () => {
  assert.equal(ParseRetryAfter("120"), 120_000);
  assert.equal(ParseRetryAfter(null), undefined);
  assert.equal(ParseRetryAfter("0"), undefined);
  assert.equal(ParseRetryAfter("garbage"), undefined);
  assert.equal(ParseRetryAfter(new Date(Date.now() - 60_000).toUTCString()), undefined);
  // HTTP-dates carry no milliseconds, so the parsed delta lands just under the
  // full minute.
  const parsed = ParseRetryAfter(new Date(Date.now() + 60_000).toUTCString());
  assert.ok(parsed !== undefined && parsed > 59_000 && parsed <= 60_000);
});

test("only edge-refusal statuses trip the breaker", () => {
  for (const status of [403, 408, 425, 429, 500, 502, 503, 504]) assert.equal(IsTripStatus(status), true);
  for (const status of [200, 204, 401, 404, 501]) assert.equal(IsTripStatus(status), false);
});
