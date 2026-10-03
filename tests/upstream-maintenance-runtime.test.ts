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

test("syllable gradients recover after seeking Sung to NotSung and directly back to Sung", () => {
  const code = source("../src/utils/Lyrics/Animator/Lyrics/LyricsAnimator.ts");
  const styles = code.slice(code.indexOf("const _styleCache"), code.indexOf("const createWordSprings"));
  const reset = code.slice(code.indexOf("const resetSyllableLineToNotSung"), code.indexOf("// DotGroup Springs Function"));
  const spline = { at: () => 0 };
  const api = runInNewContext(`${styles}\n${reset}\n({ setStyleIfChanged, flushStyleBatch, resetSyllableLineToNotSung });`, {
    $simpleLyricsMode: { get: () => false }, GradientUnsungPosition: -40,
    ScaleSpline: spline, YOffsetSpline: spline, GlowSpline: spline,
    LetterScaleSpline: spline, LetterYOffsetSpline: spline,
  });
  const element = () => {
    const values = new Map<string, string>();
    return { values, style: { setProperty: (key: string, value: string) => values.set(key, value) } };
  };
  const springs = () => ({ Scale: { SetGoal() {} }, YOffset: { SetGoal() {} }, Glow: { SetGoal() {} } });
  const word = {
    HTMLElement: element(), RomajiElement: element(), AnimatorStore: springs(),
    Letters: [{ HTMLElement: element(), AnimatorStore: springs() }],
  };
  const owners = [word.HTMLElement, word.RomajiElement, word.Letters[0].HTMLElement];
  const sung = () => {
    for (const el of owners) api.setStyleIfChanged(el, "--gradient-position", "100%");
    api.flushStyleBatch();
  };
  sung();
  api.resetSyllableLineToNotSung([word]);
  api.flushStyleBatch();
  for (const el of owners) assert.equal(el.values.get("--gradient-position"), "-40%");
  sung();
  for (const el of owners) assert.equal(el.values.get("--gradient-position"), "100%");
});

test("latest-version lookup uses the edge endpoint and parses version without the lyrics query", async () => {
  let ok = true;
  let body = "6.3.142";
  const api = runInNewContext(`${source("../src/components/Global/Session.ts")}\nSession.SpicyLyrics;`, {
    $spicyLyricsVersion: { get: () => "6.3.142" }, AbortSignal,
    fetch: async (url: string, init: RequestInit) => {
      assert.equal(url, "https://api.spicylyrics.org/edge/service?lookup=version");
      assert.equal(init.cache, "no-store");
      assert.ok(init.signal instanceof AbortSignal);
      return { ok, text: async () => body };
    },
  });
  assert.equal((await api.GetLatestVersion()).Text, "6.3.142");
  assert.equal(await api.IsOutdated(), false);
  body = "unavailable";
  assert.equal(await api.GetLatestVersion(), undefined);
  body = "6.3.143";
  assert.equal(await api.IsOutdated(), true);
  ok = false;
  assert.equal(await api.GetLatestVersion(), undefined);
});

function frameHarness(enabled = false, fps: unknown = 60) {
  let nextFrame: (timestamp: number) => void;
  const listeners: (() => void)[] = [];
  const errors: unknown[] = [];
  const api = runInNewContext(`${source("../src/utils/AnimationFrameLoop.ts")}\n({ onAnimationFrame, requestCappedFrame, cancelCappedFrame });`, {
    $animationFpsCapEnabled: { get: () => enabled, listen: (fn: () => void) => listeners.push(fn) },
    $animationFpsCap: { get: () => fps, listen: (fn: () => void) => listeners.push(fn) },
    requestAnimationFrame: (fn: (timestamp: number) => void) => { nextFrame = fn; },
    console: { error: (...args: unknown[]) => errors.push(args) },
  });
  return {
    api, errors,
    tick: (timestamp: number) => nextFrame(timestamp),
    set: (capEnabled: boolean, cap: unknown) => { enabled = capEnabled; fps = cap; listeners.forEach(fn => fn()); },
  };
}

test("the shared frame cap is opt-in, preserves cadence, and validates saved values", () => {
  const h = frameHarness();
  let calls = 0;
  h.api.onAnimationFrame(() => calls++);
  for (let i = 0; i < 144; i++) h.tick(i * 1000 / 144);
  assert.equal(calls, 144);
  calls = 0;
  h.set(true, 60);
  for (let i = 144; i < 288; i++) h.tick(i * 1000 / 144);
  assert.ok(calls >= 59 && calls <= 61, `rendered ${calls} frames`);
  calls = 0;
  h.set(true, "invalid");
  for (let i = 288; i < 432; i++) h.tick(i * 1000 / 144);
  assert.ok(calls >= 59 && calls <= 61);
  calls = 0;
  h.set(true, 0);
  for (let i = 432; i < 576; i++) h.tick(i * 1000 / 144);
  assert.ok(calls >= 14 && calls <= 16);
});

test("frame subscribers survive exceptions, unsubscribe, and schedule one-shots on later frames", () => {
  const h = frameHarness();
  const stop = h.api.onAnimationFrame(() => { throw new Error("subscriber failed"); });
  let calls = 0;
  h.api.onAnimationFrame(() => calls++);
  const cancelled = h.api.requestCappedFrame(() => { throw new Error("cancelled callback ran"); });
  h.api.cancelCappedFrame(cancelled);
  let shots = 0;
  h.api.requestCappedFrame(() => {
    shots++;
    h.api.requestCappedFrame(() => shots++);
  });
  h.tick(0);
  assert.equal(calls, 1);
  assert.equal(shots, 1);
  assert.equal(h.errors.length, 1);
  stop();
  h.tick(16);
  assert.equal(calls, 2);
  assert.equal(shots, 2);
  assert.equal(h.errors.length, 1);
});

test("popup volume drags end in their own document and ignore emulated mouse taps", () => {
  const code = source("../src/components/Utils/NowBar.ts");
  const start = code.indexOf("        let isDragging = false;", code.indexOf("const volumeMaid"));
  const end = code.indexOf("        const wheelHandler", start);
  const listeners = new Map<string, unknown>();
  const popup = {
    body: { style: { userSelect: "" } },
    addEventListener: (name: string, fn: unknown) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  let locked = false;
  let now = 0;
  const volumes: number[] = [];
  const api = runInNewContext(`let lastAudibleVolume = 0; const DEFAULT_UNMUTE_VOLUME = 0.5;\n${code.slice(start, end)}\n({ render, handleDragStart, handleDragMove, handleDragEnd, handleDragCancel });`, {
    document: { addEventListener: () => assert.fail("used main document") },
    VolumeElement: {
      ownerDocument: popup,
      style: { setProperty: () => {} },
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      getBoundingClientRect: () => ({ top: 0, height: 100 }),
    },
    performance: { now: () => now },
    SetControlsDragLock: (value: boolean) => { locked = value; },
    Spicetify: { Player: { setVolume: (value: number) => volumes.push(value), setMute: () => {} } },
  });
  const point = { clientX: 10, clientY: 95 };
  const target = { closest: () => true };
  api.render(0.8);
  api.handleDragStart({ touches: [point], target });
  assert.ok(listeners.has("touchend"));
  assert.equal(popup.body.style.userSelect, "none");
  api.handleDragEnd({ changedTouches: [point], target });
  assert.deepEqual(volumes, [0]);
  assert.equal(listeners.size, 0);
  assert.equal(locked, false);
  api.handleDragStart({ ...point, target });
  api.handleDragEnd({ ...point, target });
  assert.deepEqual(volumes, [0]);
  now = 1000;
  api.handleDragStart({ ...point, target });
  api.handleDragEnd({ ...point, target });
  assert.deepEqual(volumes, [0, 0.8]);
  now = 2000;
  api.handleDragStart({ touches: [point], target });
  api.handleDragMove({ touches: [{ clientX: 20, clientY: 95 }], target });
  assert.ok(Math.abs(volumes.at(-1)! - 0.05) < 1e-10);
  api.handleDragCancel();
  assert.equal(listeners.size, 0);
  assert.equal(popup.body.style.userSelect, "");
  assert.equal(locked, false);
});

for (const frameMs of [16, 1000 / 15]) test(`smooth scrolling follows geometry and cancels at ${Math.round(1000 / frameMs)} FPS`, () => {
  let enabled = true;
  let frameId = 0;
  const frames = new Map<number, (timestamp: number) => void>();
  const api = runInNewContext(`${source("../src/utils/Lyrics/LyricsVirtualizer.ts")}\nlyricsVirtualizer;`, {
    Spring, Logger: logger,
    $smoothScrolling: { get: () => enabled },
    performance: { now: () => 0 },
    requestAnimationFrame: (callback: (timestamp: number) => void) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    requestCappedFrame: (callback: (timestamp: number) => void) => { frames.set(++frameId, callback); return frameId; },
    cancelCappedFrame: (id: number) => frames.delete(id),
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
    timestamp += frameMs;
    callback(timestamp);
  }
  for (let i = 0; i < 2; i++) tick();
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
