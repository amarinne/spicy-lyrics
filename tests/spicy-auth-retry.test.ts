import assert from "node:assert/strict";
import { test } from "node:test";

// The CircuitBreaker module graph (via SpicyAuthRetry) reads localStorage and
// Spicetify at import time; shim both, then import dynamically so the shims
// land first (static imports would evaluate before the file body).
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  },
});
Object.defineProperty(globalThis, "Spicetify", {
  configurable: true,
  value: { LocalStorage: { get: () => null, set: () => {} } },
});
Object.defineProperty(globalThis, "window", { configurable: true, value: {} });

const { ServiceUnavailableError } = await import("../src/utils/API/CircuitBreaker.ts");
const { acquireSpicyOutcomeWithBoundedAuthRetry } = await import("../src/utils/Lyrics/SpicyAuthRetry.ts");

test("auth rejection retries once then stops", async () => {
  let attempts = 0; let invalidations = 0; let tokens = 0;
  const result = await acquireSpicyOutcomeWithBoundedAuthRetry({
    signal: new AbortController().signal,
    resolveToken: async () => `token-${++tokens}`,
    invalidateToken: () => { invalidations += 1; },
    runAttempt: async () => { attempts += 1; return { kind: "auth-rejected", status: 401 } as const; },
  });
  assert.deepEqual(result, { kind: "upstream-error", status: 401 });
  assert.equal(attempts, 2); assert.equal(tokens, 2); assert.equal(invalidations, 1);
});

test("successful retry returns lyrics", async () => {
  let attempts = 0;
  let tokens = 0;
  const result = await acquireSpicyOutcomeWithBoundedAuthRetry({
    signal: new AbortController().signal,
    resolveToken: async () => `token-${++tokens}`,
    invalidateToken: () => {},
    runAttempt: async () => ++attempts === 1 ? { kind: "auth-rejected", status: 401 } as const : { kind: "settled", outcome: { kind: "lyrics", result: { ok: true } } } as const,
  });
  assert.deepEqual(result, { kind: "lyrics", result: { ok: true } });
  assert.equal(attempts, 2);
});

test("aborted signal does not invalidate or retry", async () => {
  const controller = new AbortController(); let attempts = 0; let invalidations = 0;
  const result = await acquireSpicyOutcomeWithBoundedAuthRetry({
    signal: controller.signal,
    resolveToken: async () => "token",
    invalidateToken: () => { invalidations += 1; },
    runAttempt: async () => { attempts += 1; controller.abort(); return { kind: "auth-rejected", status: 401 } as const; },
  });
  assert.deepEqual(result, { kind: "aborted" }); assert.equal(attempts, 1); assert.equal(invalidations, 0);
});

test("unchanged or unavailable retry token preserves the original rejection", async () => {
  for (const refreshFails of [false, true]) {
    let reads = 0;
    let attempts = 0;
    const result = await acquireSpicyOutcomeWithBoundedAuthRetry({
      signal: new AbortController().signal,
      resolveToken: async () => {
        if (++reads === 2 && refreshFails) throw new Error("unavailable");
        return "rejected";
      },
      invalidateToken: (token) => assert.equal(token, "rejected"),
      runAttempt: async () => { attempts++; return { kind: "auth-rejected", status: 401 } as const; },
    });
    assert.deepEqual(result, { kind: "upstream-error", status: 401 });
    assert.equal(attempts, 1);
  }
});

test("abort during failed refresh remains cancellation", async () => {
  const controller = new AbortController();
  let reads = 0;
  const result = await acquireSpicyOutcomeWithBoundedAuthRetry({
    signal: controller.signal,
    resolveToken: async () => {
      if (++reads === 2) { controller.abort(); throw new Error("unavailable"); }
      return "rejected";
    },
    invalidateToken: () => {},
    runAttempt: async () => ({ kind: "auth-rejected", status: 401 } as const),
  });
  assert.deepEqual(result, { kind: "aborted" });
});

test("a transport-level 403 is a plain upstream error, not an auth rejection", async () => {
  let attempts = 0; let invalidations = 0;
  const result = await acquireSpicyOutcomeWithBoundedAuthRetry({
    signal: new AbortController().signal,
    resolveToken: async () => "token",
    invalidateToken: () => { invalidations += 1; },
    runAttempt: async () => { attempts += 1; return { kind: "settled", outcome: { kind: "upstream-error", status: 403 } } as const; },
  });
  assert.deepEqual(result, { kind: "upstream-error", status: 403 });
  assert.equal(attempts, 1); assert.equal(invalidations, 0);
});

test("breaker suppression on the retry keeps the original 401", async () => {
  let attempts = 0; let tokens = 0; let invalidations = 0;
  const result = await acquireSpicyOutcomeWithBoundedAuthRetry({
    signal: new AbortController().signal,
    resolveToken: async () => `token-${++tokens}`,
    invalidateToken: () => { invalidations += 1; },
    runAttempt: async () => {
      attempts += 1;
      if (attempts === 1) return { kind: "auth-rejected", status: 401 } as const;
      throw new ServiceUnavailableError(30_000);
    },
  });
  assert.deepEqual(result, { kind: "upstream-error", status: 401 });
  assert.equal(attempts, 2); assert.equal(tokens, 2); assert.equal(invalidations, 1);
});

test("suppression on the first attempt propagates for the adapter to map", async () => {
  await assert.rejects(
    () => acquireSpicyOutcomeWithBoundedAuthRetry({
      signal: new AbortController().signal,
      resolveToken: async () => "token",
      invalidateToken: () => {},
      runAttempt: async () => { throw new ServiceUnavailableError(30_000); },
    }),
    ServiceUnavailableError,
  );
});
