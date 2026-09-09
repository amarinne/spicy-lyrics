import assert from "node:assert/strict";
import { test } from "node:test";
import { acquireSpicyOutcomeWithBoundedAuthRetry } from "../src/utils/Lyrics/SpicyAuthRetry.ts";

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
    runAttempt: async () => ++attempts === 1 ? { kind: "auth-rejected", status: 403 } as const : { kind: "settled", outcome: { kind: "lyrics", result: { ok: true } } } as const,
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
    runAttempt: async () => ({ kind: "auth-rejected", status: 403 } as const),
  });
  assert.deepEqual(result, { kind: "aborted" });
});
