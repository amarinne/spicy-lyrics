import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { Spring } from "../src/modules/Spring.ts";

// Run the production control flow with deterministic browser and store boundaries.
function source(path: string): string {
  return stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), "utf8")
    .replace(/^import\s+[\s\S]*?;\n/gm, ""))
    .replace(/export default /g, "")
    .replace(/export /g, "");
}

const logger = class { debug() {} info() {} warn() {} };

test("smooth scrolling follows changed row geometry and releases its frame on cancellation", () => {
  let enabled = true;
  let frameId = 0;
  const frames = new Map<number, (timestamp: number) => void>();
  const api = runInNewContext(`${source("../src/utils/Lyrics/LyricsVirtualizer.ts")}\nlyricsVirtualizer;`, {
    Spring, Logger: logger,
    $smoothScrolling: { get: () => enabled },
    performance: { now: () => 0 },
    requestAnimationFrame: (callback: (timestamp: number) => void) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  });
  const scroll = {
    scrollTop: 0, clientHeight: 200, scrollHeight: 1200,
    getBoundingClientRect: () => ({ top: 0 }),
    scrollTo: ({ top }: { top: number }) => { scroll.scrollTop = top; },
  };
  const container = { style: { translate: "" }, getBoundingClientRect: () => ({ top: -scroll.scrollTop }) };
  const row = { start: 400, size: 40 };
  api._virtualizer = { scrollElement: scroll, measurementsCache: [row], getTotalSize: () => 1000, scrollOffset: 0 };
  api._virtualContainer = container;
  api._mountedIndices.add(0);
  api._onVirtualizerChange = () => {};
  api._remeasureVisible = () => {};
  api.scrollToIndex(0);
  let timestamp = 0;
  function tick() {
    const [id, callback] = frames.entries().next().value!;
    frames.delete(id);
    timestamp += 16;
    callback(timestamp);
  }
  for (let i = 0; i < 8; i++) tick();
  assert.ok(scroll.scrollTop > 0 && scroll.scrollTop < 320);
  // An interlude expands above the target while the glide is running.
  row.start = 600;
  for (let i = 0; frames.size && i < 200; i++) tick();
  assert.equal(scroll.scrollTop, 520);
  assert.equal(container.style.translate, "");
  assert.equal(api._converging, false);
  row.start = 900;
  api.scrollToIndex(0);
  tick();
  assert.ok(frames.size > 0);
  api._onUserScrollIntent();
  assert.equal(frames.size, 0);
  assert.equal(container.style.translate, "");
  assert.equal(api._converging, false);
  // Turning the setting off continues toward the same target on the normal path.
  api.scrollToIndex(0);
  enabled = false;
  let handedOff: unknown[] = [];
  api._scrollToIndexWithRetry = (...args: unknown[]) => { handedOff = args; };
  api._handOffSmoothScroll();
  assert.equal(frames.size, 0);
  assert.deepEqual(handedOff.slice(0, 4), [0, "center", false, 0]);
});

test("a parked skeleton apply cannot publish after a track switch or page teardown", async () => {
  let uri = "spotify:track:first";
  let resolvePaint: () => void = () => {};
  let applied = 0;
  const page = { isConnected: true, querySelector: () => null };
  const context = {
    PageContainer: page,
    SpotifyPlayer: { GetUri: () => uri },
    IsLyricsSkeletonEnabled: () => true,
    PaintLyricsSkeleton: () => new Promise<void>((resolve) => { resolvePaint = resolve; }),
    HideLyricsSkeleton: () => {}, HideLoaderContainer: () => {},
    setBlurringLastLine: () => {}, EmitNotApplyed: () => {},
    DestroyAllLyricsContainers: () => {}, ClearLyricsContentArrays: () => {},
    ClearScrollSimplebar: () => {}, ClearLyricsPageContainer: () => {}, CleanUpIsByCommunity: () => {},
    isRomanized: true,
    ApplyStaticLyrics: () => { applied++; },
  };
  const api = runInNewContext(`${source("../src/utils/Lyrics/Global/Applyer.ts")}\n({ ApplyLyrics, cleanupApplyLyricsAbortController });`, context);
  const oldApply = api.ApplyLyrics([{ uri, Type: "Static", Lines: [] }, 200]);
  uri = "spotify:track:second";
  resolvePaint();
  await oldApply;
  assert.equal(applied, 0);
  const tornDownApply = api.ApplyLyrics([{ uri, Type: "Static", Lines: [] }, 200]);
  api.cleanupApplyLyricsAbortController();
  resolvePaint();
  await tornDownApply;
  assert.equal(applied, 0);
  const currentApply = api.ApplyLyrics([{ uri, Type: "Static", Lines: [] }, 200]);
  resolvePaint();
  await currentApply;
  assert.equal(applied, 1);
});

test("bounded waits stop polling and do not retry a throwing callback", () => {
  let now = 0;
  const timers: (() => void)[] = [];
  const api = runInNewContext(`${source("../src/modules/Whentil.ts")}\nWhentil;`, {
    performance: { now: () => now },
    setTimeout: (callback: () => void) => timers.push(callback),
    console: { error: () => {} },
  });
  let calls = 0;
  api.When(() => true, () => { calls++; throw new Error("callback failed"); });
  timers.shift()!();
  assert.equal(calls, 1);
  assert.equal(timers.length, 0);
  api.When(() => false, () => { calls++; }, 1, 50);
  timers.shift()!();
  now = 51;
  timers.shift()!();
  assert.equal(timers.length, 0);
  assert.equal(calls, 1);
});
