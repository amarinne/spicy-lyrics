import assert from "node:assert/strict";
import { test } from "node:test";
import { LyricsRequestCoordinator } from "../src/utils/Lyrics/LyricsRequestSession.ts";
import { acquireProviderOutcomes, runProviderAcquisition } from "../src/utils/Lyrics/ProviderAcquisition.ts";

test("same-track callers coalesce onto one request", async () => {
  const coordinator = new LyricsRequestCoordinator<string>();
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = coordinator.run("spotify:track:a", async () => { calls++; await gate; return "done"; });
  const second = coordinator.run("spotify:track:a", async () => { calls++; return "duplicate"; });
  assert.equal(first, second);
  release();
  assert.equal(await second, "done");
  assert.equal(calls, 1);
});

test("completed request keeps its stale-publication guard until the next run", async () => {
  const coordinator = new LyricsRequestCoordinator<string>();
  let firstCurrent: (() => boolean) | undefined;
  assert.equal(await coordinator.run("spotify:track:a", async (session) => { firstCurrent = session.isCurrent; return "first"; }), "first");
  assert.equal(firstCurrent?.(), true);
  assert.equal(await coordinator.run("spotify:track:a", async () => "second"), "second");
  assert.equal(firstCurrent?.(), false);
});

test("a new track aborts the stale session", async () => {
  const coordinator = new LyricsRequestCoordinator<string>();
  let staleSignal: AbortSignal | undefined;
  const stale = coordinator.run("spotify:track:a", async (session) => {
    staleSignal = session.signal;
    if (session.signal.aborted) return "stale";
    await new Promise<void>((resolve) => session.signal.addEventListener("abort", () => resolve(), { once: true }));
    return session.isCurrent() ? "current" : "stale";
  });
  await Promise.resolve();
  const current = coordinator.run("spotify:track:b", async () => "current");
  assert.equal(await stale, "stale");
  assert.equal(staleSignal?.aborted, true);
  assert.equal(await current, "current");
});

test("provider acquisition maps timeout and parent cancellation", async () => {
  const timeout = await runProviderAcquisition(async (signal) => {
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    throw new Error("aborted");
  }, undefined, 5);
  assert.equal(timeout.kind, "timeout");

  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await runProviderAcquisition(async () => ({ kind: "no-match" }), controller.signal), { kind: "aborted" });
});

test("sequential acquisition continues past queued and no-match until usable lyrics", async () => {
  const outcomes = new Map([["spicy", { kind: "queued" }], ["spotify", { kind: "no-match" }], ["lrclib", { kind: "lyrics", result: "ok" }]] as const);
  const records = await acquireProviderOutcomes(["spicy", "spotify", "lrclib"], "sequential", async (provider) => outcomes.get(provider)!);
  assert.deepEqual(records.map((record) => record.outcome.kind), ["queued", "no-match", "lyrics"]);
});
