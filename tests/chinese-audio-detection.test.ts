import assert from "node:assert/strict";
import { test } from "node:test";
import { CHINESE_AUDIO_REVISION, ChineseAudioDetector, classifyChineseAudio, validChineseAudioDecision, type ChinesePlayback } from "../src/utils/Lyrics/ChineseAudioDetection.ts";
import { chineseAudioLyricLines } from "../src/utils/Lyrics/ChineseAudioLyrics.ts";
import { resolveChineseTranslitMode } from "../src/utils/Lyrics/ChineseTranslitMode.ts";
import { romanizeMandarin, romanizeMandarinVn, romanizeCantonese, romanizeCantoneseVn, toggleChineseTranslitLanguage } from "../src/utils/Lyrics/Fork/Romanization.ts";
import { ensureMandarinSegmenter } from "../src/utils/Lyrics/Fork/MandarinEzaLine.ts";

test("phone fit needs two windows and overrides LID; otherwise three LID windows decide", () => {
  const lid = (logOdds: number) => ({ logOdds, phoneFit: null });
  assert.equal(classifyChineseAudio([lid(-6), lid(-8), lid(-7)])?.language, "yue");
  assert.equal(classifyChineseAudio([lid(-9.9), lid(-14), lid(-15)])?.language, "cmn");
  assert.equal(classifyChineseAudio([lid(-10), lid(-10), lid(-10)])?.language, "cmn");
  const phone = (phoneFit: number | null, logOdds: number | null = -14) => ({ logOdds, phoneFit });
  const canto = classifyChineseAudio([phone(0.05), phone(0.04), phone(null)]);
  assert.equal(canto?.language, "yue");
  assert.equal(canto?.method, "phone");
  assert.equal(classifyChineseAudio([phone(-0.01), phone(0.0), phone(null)])?.language, "cmn");
  assert.equal(classifyChineseAudio([phone(0.025), phone(0.025), phone(null)])?.language, "cmn");
  assert.equal(classifyChineseAudio([phone(0.03), phone(0.04), lid(-14)])?.method, "phone");
  assert.equal(classifyChineseAudio([phone(0.03), lid(-14), lid(-14)])?.method, "lid");
  for (const windows of [[], [lid(-5)], [lid(-5), lid(-5)],
    [{ logOdds: null, phoneFit: null }, { logOdds: null, phoneFit: null }, { logOdds: null, phoneFit: null }],
    [{ logOdds: null, phoneFit: 0.03 }, lid(-5), lid(-5)],
    [{ logOdds: NaN, phoneFit: null }, lid(-5), lid(-5)]]) {
    assert.equal(classifyChineseAudio(windows), undefined);
  }
  const valid = { revision: CHINESE_AUDIO_REVISION, language: "yue", method: "phone", windows: [phone(0.05), phone(0.04), phone(null)] };
  assert.equal(validChineseAudioDecision(valid), true);
  assert.equal(validChineseAudioDecision({ ...valid, language: "cmn" }), false);
  assert.equal(validChineseAudioDecision({ ...valid, method: "lid" }), false);
  assert.equal(validChineseAudioDecision({ ...valid, revision: "old" }), false);
  assert.equal(validChineseAudioDecision({ revision: CHINESE_AUDIO_REVISION, language: "yue", method: "phone",
    windows: [phone(-0.05), phone(-0.04), phone(null)] }), false);
});

test("audio payload carries one reading per Han character and skips non-Chinese lines", () => {
  const staticDoc = { Type: "Static", Lines: [
    { Text: "你好香港" }, { Text: "[00:12.34] 再見" }, { Text: "English only" }, { Text: "" },
  ] };
  const lines = chineseAudioLyricLines(staticDoc);
  assert.deepEqual(lines.map((line) => line.han), ["你好香港", "再見"]);
  for (const line of lines) {
    assert.equal(line.py.length, line.han.length);
    assert.equal(line.jp.length, line.han.length);
  }
  assert.deepEqual(lines[0].py, ["ni", "hao", "xiang", "gang"]);
  assert.deepEqual(lines[0].jp, ["nei", "hou", "hoeng", "gong"]);
  const lineDoc = { Type: "Line", Content: [{ Type: "Vocal", Text: "告別" }, { Type: "Interlude" }] };
  assert.deepEqual(chineseAudioLyricLines(lineDoc).map((line) => line.han), ["告別"]);
  const syllableDoc = { Type: "Syllable", Content: [{ Type: "Vocal", Lead: {
    StartTime: 0, EndTime: 1, Text: "喜歡你",
    Syllables: Array.from("喜歡你", (Text) => ({ Text })),
  } }] };
  assert.deepEqual(chineseAudioLyricLines(syllableDoc).map((line) => line.han), ["喜歡你"]);
});

test("auto keeps the output style while manual modes override audio", async () => {
  assert.equal(resolveChineseTranslitMode("auto", "yue"), "jyutping");
  assert.equal(resolveChineseTranslitMode("auto-vn", "yue"), "jyutping-vn");
  assert.equal(resolveChineseTranslitMode("auto", "cmn"), "pinyin");
  assert.equal(resolveChineseTranslitMode("auto-vn", "cmn"), "pinyin-vn");
  assert.equal(resolveChineseTranslitMode("auto-vn"), "pinyin-vn");
  for (const mode of ["pinyin", "jyutping", "pinyin-vn", "jyutping-vn"] as const) {
    assert.equal(resolveChineseTranslitMode(mode, "yue"), mode);
    assert.equal(resolveChineseTranslitMode(mode, "cmn"), mode);
  }
  assert.equal(toggleChineseTranslitLanguage(resolveChineseTranslitMode("auto-vn", "yue")), "pinyin-vn");
  await ensureMandarinSegmenter();
  const readings = {
    pinyin: () => romanizeMandarin("你好", true),
    "pinyin-vn": () => romanizeMandarinVn("你好", true),
    jyutping: () => romanizeCantonese("你好", "yue", true, true),
    "jyutping-vn": () => romanizeCantoneseVn("你好", "yue", true, true),
  };
  assert.equal(await readings[resolveChineseTranslitMode("auto", "yue")](), "nei5 hou2");
  assert.equal(await readings[resolveChineseTranslitMode("auto-vn", "yue")](), "nẻi hóu");
  assert.equal(await readings[resolveChineseTranslitMode("auto-vn", "cmn")](), "ní hảo");
});

function harness() {
  let now = 0;
  const state: ChinesePlayback = { uri: "track-a", playing: true, positionMs: 0, eligible: true };
  const pending: { signal: AbortSignal; resolve: (value: { logOdds: number | null; phoneFit: number | null } | null) => void; reject: (reason?: unknown) => void }[] = [];
  const saved: { uri: string; language: string }[] = [];
  const detector = new ChineseAudioDetector({
    playback: () => ({ ...state }), now: () => now,
    cached: (uri) => saved.some((r) => r.uri === uri),
    save: (uri, decision) => saved.push({ uri, language: decision.language }),
    capture: (_uri, signal) => new Promise((resolve, reject) => pending.push({ signal, resolve, reject })),
  });
  const advance = (ms: number) => { now += ms; if (state.playing) state.positionMs += ms; };
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  return { state, pending, saved, detector, advance, settle };
}

test("phone fit decides when LID points the other way", async () => {
  const h = harness();
  const values = [
    { logOdds: -14, phoneFit: 0.05 },
    { logOdds: -14, phoneFit: 0.04 },
    { logOdds: -14, phoneFit: null },
  ];
  for (let i = 0; i < 3; i++) {
    h.detector.tick();
    h.advance(30_000);
    h.pending[i].resolve(values[i]);
    await h.settle();
    h.advance(2000);
  }
  assert.deepEqual(h.saved, [{ uri: "track-a", language: "yue" }]);
});

test("three windows publish once, cache stops recording, and requests never overlap", async () => {
  const h = harness();
  for (let i = 0; i < 3; i++) {
    h.detector.tick();
    h.detector.tick();
    assert.equal(h.pending.length, i + 1);
    h.advance(30_000);
    h.pending[i].resolve({ logOdds: -6, phoneFit: null });
    await h.settle();
    assert.equal(h.saved.length, i === 2 ? 1 : 0);
    h.advance(2000);
  }
  assert.deepEqual(h.saved, [{ uri: "track-a", language: "yue" }]);
  h.detector.tick();
  assert.equal(h.pending.length, 3);
});

test("track changes cancel old evidence even if the response arrives late", async () => {
  const h = harness();
  h.detector.tick();
  h.state.uri = "track-b";
  h.detector.tick();
  assert.equal(h.pending[0].signal.aborted, true);
  h.pending[0].resolve({ logOdds: -5, phoneFit: null });
  await h.settle();
  assert.deepEqual(h.saved, []);
  for (let i = 1; i <= 3; i++) {
    h.advance(30_000);
    h.pending[i].resolve({ logOdds: -15, phoneFit: null });
    await h.settle();
    h.advance(2000);
    h.detector.tick();
  }
  assert.deepEqual(h.saved, [{ uri: "track-b", language: "cmn" }]);
});

test("pause, seek, manual selection, and unload cancel capture", () => {
  for (const interrupt of [
    (h: ReturnType<typeof harness>) => { h.state.playing = false; },
    (h: ReturnType<typeof harness>) => { h.state.positionMs = 50_000; },
    (h: ReturnType<typeof harness>) => { h.state.eligible = false; },
    (h: ReturnType<typeof harness>) => h.detector.stop(),
  ]) {
    const h = harness();
    h.detector.tick();
    interrupt(h);
    h.detector.tick();
    assert.equal(h.pending[0].signal.aborted, true);
    assert.deepEqual(h.saved, []);
  }
});

test("helper failure backs off and silence never becomes a Mandarin decision", async () => {
  const h = harness();
  h.detector.tick();
  h.pending[0].reject(new Error("helper offline"));
  await h.settle();
  h.advance(5000);
  h.detector.tick();
  assert.equal(h.pending.length, 1);
  h.advance(55_000);
  for (let i = 1; i <= 6; i++) {
    h.detector.tick();
    h.advance(30_000);
    h.pending[i].resolve(null);
    await h.settle();
    h.advance(2000);
  }
  h.detector.tick();
  assert.equal(h.pending.length, 7);
  assert.deepEqual(h.saved, []);
});

test("seeking back cannot count the same audio twice", async () => {
  const h = harness();
  h.detector.tick();
  h.advance(30_000);
  h.pending[0].resolve({ logOdds: -5, phoneFit: null });
  await h.settle();
  h.advance(2000);
  h.state.positionMs = 10_000;
  h.detector.tick();
  assert.equal(h.pending.length, 1);
  h.state.positionMs = 31_000;
  h.detector.tick();
  assert.equal(h.pending.length, 2);
  h.detector.stop();
});
