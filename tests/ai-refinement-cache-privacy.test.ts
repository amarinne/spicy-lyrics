import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { MemoryRefinementCache, measureRecordBytes, refinementRecordKey, sumBudgetConsumed, type RefinementRecord } from "../src/utils/Lyrics/AIRefinement/index.ts";

function record(index: number, overrides: Partial<RefinementRecord> = {}): RefinementRecord {
  const key = refinementRecordKey(`spotify:track:${index}`, "config", "digest");
  const value: RefinementRecord = { key, trackUri: `spotify:track:${index}`, schema: 1, configId: "config", docDigest: "digest", chunkPlanVersion: 1, providerId: "fake", providerVersion: "1", modelName: "fake", targetLang: "en", createdAt: index, lastAccessedAt: index, bytes: 0, status: "complete", tokens: { input: 1, output: 2 }, usageEstimated: false, budgetConsumed: 3, items: {}, chunks: {}, ...overrides };
  value.bytes = measureRecordBytes(value);
  return value;
}

test("memory cache supports exact reads, track clears, true LRU and pinning", async () => {
  const cache = new MemoryRefinementCache();
  for (let i = 0; i < 200; i++) await cache.put(record(i));
  cache.pin(record(0).key);
  await cache.put(record(200));
  const keys = new Set(cache.snapshot().map((item) => item.key));
  assert.ok(keys.has(record(0).key));
  assert.ok(!keys.has(record(1).key));
  await cache.deleteTrack("spotify:track:200");
  assert.equal(await cache.get(record(200).key), undefined);
});

test("cache write failure does not pretend to persist and budgets aggregate", async () => {
  const cache = new MemoryRefinementCache();
  cache.failWrites = true;
  await assert.rejects(() => cache.put(record(1)));
  assert.equal(cache.snapshot().length, 0);
  assert.equal(sumBudgetConsumed([record(1), record(2, { budgetConsumed: 9 })]), 12);
});

test("private replay path is ignored, untracked, and production sources do not import it", () => {
  const ignore = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
  assert.match(ignore, /^tests\/private\/ai-refinement-replay\/$/m);
  const index = readFileSync(new URL("../.git/index", import.meta.url));
  assert.equal(index.includes(Buffer.from("tests/private/ai-refinement-replay/")), false);
  const sourceDir = new URL("../src/utils/Lyrics/AIRefinement/", import.meta.url);
  const production = readdirSync(sourceDir).filter((name) => name.endsWith(".ts")).map((name) => readFileSync(new URL(name, sourceDir), "utf8")).join("\n");
  assert.doesNotMatch(production, /tests\/private\/ai-refinement-replay|utils\/API\/Query/);
});
