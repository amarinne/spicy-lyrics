import assert from "node:assert/strict";
import { test } from "node:test";
import { CHINESE_AUDIO_REVISION } from "../src/utils/Lyrics/ChineseAudioDetection.ts";

const lid = (logOdds: number) => ({ logOdds, phoneFit: null });
const decision = (language: "yue" | "cmn") => ({
  revision: CHINESE_AUDIO_REVISION, language, method: "lid" as const,
  windows: [lid(-6), lid(-7), lid(-8)],
});

test("track decisions hydrate, preserve manual modes, and still publish when storage is full", async () => {
  const track = "spotify:track:" + "a".repeat(22);
  const other = "spotify:track:" + "b".repeat(22);
  let raw = JSON.stringify({
    [track]: decision("yue"),
    [other]: { revision: "old", scores: [-6, -7, -8], language: "yue" },
  });
  let failWrite = false;
  (globalThis as any).Spicetify = { LocalStorage: {
    get: () => raw,
    set: (_key: string, value: string) => { if (failWrite) throw new Error("quota"); raw = value; },
  } };
  const state = await import("../src/utils/Lyrics/ChineseAudioState.ts");
  assert.equal(state.resolvedChineseMode("auto", track), "jyutping");
  assert.equal(state.resolvedChineseMode("auto-vn", track), "jyutping-vn");
  assert.equal(state.resolvedChineseMode("pinyin-vn", track), "pinyin-vn");
  assert.equal(state.hasChineseAudioDecision(other), false);
  // A confident text guess is visible before the first audio window arrives.
  assert.equal(state.resolvedChineseMode("auto", other, { uri: other, ChineseRhymeGuess: { language: "cmn" } }), "pinyin");
  assert.equal(state.resolvedChineseMode("auto-vn", other, { uri: other, ChineseRhymeGuess: { language: "yue" } }), "jyutping-vn");
  failWrite = true;
  const before = state.$chineseAudioRevision.get();
  state.saveChineseAudioDecision(other, decision("yue"));
  assert.equal(state.$chineseAudioRevision.get(), before + 1);
  assert.equal(state.$chineseAudioStatus.get(), "detected");
  // The audio decision replaces the text guess.
  assert.equal(state.resolvedChineseMode("auto", other, { uri: other, ChineseRhymeGuess: { language: "cmn" } }), "jyutping");
  assert.equal(state.resolvedChineseMode("rhyme", track), "pinyin");
  assert.equal(state.resolvedChineseMode("rhyme-vn", track, { uri: track, ChineseRhymeGuess: { language: "cmn" } }), "pinyin-vn");
  assert.equal(state.resolvedChineseMode("rhyme-vn", other, { uri: other, ChineseRhymeGuess: { language: "yue" } }), "jyutping-vn");
  assert.equal(state.resolvedChineseMode("rhyme", other, { uri: track, ChineseRhymeGuess: { language: "yue" } }), "pinyin");
});
