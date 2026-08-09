import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AI_PROMPT_VERSION,
  EMPTY_LYRIC_CONTEXT,
  FakeRefinementProvider,
  ReplayProvider,
  executeChunk,
  exportReplay,
  importReplay,
  planChunks,
  type ProviderConfig,
  type ReplayEntry,
} from "../src/utils/Lyrics/AIRefinement/index.ts";

const descriptor = { name: "fake-model", version: "1", inputTokenLimit: 32_768, outputTokenLimit: 1_000, supportedGenerationMethods: ["generateContent"] };
const config: ProviderConfig = { providerVersion: "1", model: descriptor, targetLang: "en", context: EMPTY_LYRIC_CONTEXT, promptVersion: AI_PROMPT_VERSION, temperature: 0, contextMode: "document_or_v1_chunks", credential: { secret: "never-log" }, repair: false, maxOutputTokens: 0 };
const row = { id: "S0", class: "ordinary" as const, sendDisposition: "sent" as const, sourceText: "hola", voice: null, allowUnchanged: false, target: {}, targetField: "TranslatedText" as const };
const chunk = planChunks([row], "en", descriptor).chunks[0];

test("full-chunk repair uses byte-identical membership and caps attempts at two", async () => {
  const provider = new FakeRefinementProvider([
    { ok: true, items: [{ id: "S0", t: "hola" }], usage: { input: 4, output: 2 }, finish: "stop", raw: { bytes: 20 } },
    { ok: true, items: [{ id: "S0", t: "hello" }], usage: { input: 4, output: 2 }, finish: "stop", raw: { bytes: 20 } },
  ]);
  const result = await executeChunk({ provider, chunk, config, signal: new AbortController().signal, budgetAlreadyConsumed: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.record.attempts, 2);
  assert.equal(result.record.repairs, 1);
  assert.deepEqual(provider.calls[0].request, provider.calls[1].request);
  assert.equal(provider.calls[1].config.repair, true);
  assert.equal(provider.calls.length, 2);
});

test("delivery_unknown, truncation and safety are terminal without retry", async () => {
  for (const [response, reason] of [
    [{ ok: false, failure: { kind: "delivery_unknown", cause: "network" } }, "delivery_unknown"],
    [{ ok: true, items: [], usage: { input: 1, output: 1 }, finish: "length", raw: { bytes: 0 } }, "truncated"],
    [{ ok: true, items: [], usage: { input: 1, output: 1 }, finish: "safety", raw: { bytes: 0 } }, "provider_refused"],
  ] as const) {
    const provider = new FakeRefinementProvider([response as any]);
    const result = await executeChunk({ provider, chunk, config, signal: new AbortController().signal, budgetAlreadyConsumed: 0 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.reason, reason);
    assert.equal(provider.calls.length, 1);
  }
});

test("provider calls have a deadline and conservatively account an ambiguous timeout", async () => {
  const provider = new FakeRefinementProvider([(_request, _config, signal) => new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))]);
  const result = await executeChunk({ provider, chunk, config, signal: new AbortController().signal, budgetAlreadyConsumed: 0, deadlineMs: 1 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.reason, "delivery_unknown");
  assert.equal(result.record.attempts, 1);
  assert.equal(result.record.usageEstimated, true);
  assert.ok(result.budgetConsumed > 0);
});

test("429 retries once, caps wait, and counts absent usage conservatively", async () => {
  const waits: number[] = [];
  const provider = new FakeRefinementProvider([
    { ok: false, failure: { kind: "rate_limited", retryAfterMs: 90_000 } },
    { ok: true, items: [{ id: "S0", t: "hello" }], usage: {}, finish: "stop", raw: { bytes: 20 } },
  ]);
  const result = await executeChunk({ provider, chunk, config, signal: new AbortController().signal, budgetAlreadyConsumed: 0, wait: async (ms) => { waits.push(ms); } });
  assert.deepEqual(waits, [30_000]);
  assert.equal(result.record.attempts, 2);
  assert.equal(result.record.usageEstimated, true);
  assert.ok(result.budgetConsumed > 1_000);
});

test("cancelling during Retry-After returns the charged attempt instead of losing it", async () => {
  const provider = new FakeRefinementProvider([{ ok: false, failure: { kind: "rate_limited", retryAfterMs: 30_000 } }]);
  const result = await executeChunk({ provider, chunk, config, signal: new AbortController().signal, budgetAlreadyConsumed: 0, wait: async () => { throw new Error("cancelled"); } });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.reason, "rate_limited");
  assert.equal(result.record.attempts, 1);
  assert.ok(result.budgetConsumed > 0);
});

test("a pre-aborted run cannot dispatch through a fresh child signal", async () => {
  const provider = new FakeRefinementProvider();
  const controller = new AbortController(); controller.abort("track_change");
  await assert.rejects(() => executeChunk({ provider, chunk, config, signal: controller.signal, budgetAlreadyConsumed: 0 }));
  assert.equal(provider.calls.length, 0);
});

test("completed chunks cannot be resent", async () => {
  await assert.rejects(() => executeChunk({ provider: new FakeRefinementProvider(), chunk, config, signal: new AbortController().signal, budgetAlreadyConsumed: 0, previous: { ids: ["S0"], requestJson: chunk.requestJson, status: "complete", attempts: 1, repairs: 0, tokens: { input: 1, output: 1 }, usageEstimated: false } }), /must not be resent/);
});

test("record/replay contains no credential or headers and never calls network", async () => {
  const entry: ReplayEntry = { schema: 1, request: { context: EMPTY_LYRIC_CONTEXT, target: "en", items: [{ id: "S0", c: "ordinary", v: null, s: "synthetic source" }] }, response: { ok: true, items: [{ id: "S0", t: "synthetic translation" }], usage: { input: 3, output: 3 }, finish: "stop", raw: { bytes: 40 } }, model: descriptor };
  const serialized = exportReplay([entry]);
  assert.doesNotMatch(serialized, /never-log|x-goog-api-key|authorization/i);
  const provider = new ReplayProvider(importReplay(serialized));
  const result = await provider.translateChunk(entry.request, config, new AbortController().signal);
  assert.deepEqual(result, entry.response);
});
