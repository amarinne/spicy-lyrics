import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildProcessingContextKey,
  type ProcessingContext,
} from "../src/utils/Lyrics/ProcessingContext.ts";

const baseContext: ProcessingContext = {
  translationEnabled: true,
  translationTargetLang: "en",
  chineseTranslitMode: "pinyin",
  chineseTones: false,
  joinMandarinWords: false,
  chineseReadingPlacement: "lineBelow",
  chineseCharacterForm: "original",
  koreanDisplayMode: "rrStandard",
  cyrillicRomanizationMode: "Russian",
  cyrillicKeepSigns: false,
  japaneseReadingMode: "romaji",
};

test("processing context key is stable for same inputs", () => {
  assert.equal(
    buildProcessingContextKey(baseContext),
    buildProcessingContextKey({ ...baseContext })
  );
});

test("Mandarin eza式 rejects cached output from before the spelling revision", () => {
  const current = buildProcessingContextKey({ ...baseContext, chineseTranslitMode: "pinyin-vn" });
  const legacy = JSON.parse(current);
  delete legacy.mandarinEzaRevision;
  assert.notEqual(current, JSON.stringify(legacy));
  for (const mode of ["pinyin", "jyutping", "jyutping-vn"] as const) {
    assert.ok(!buildProcessingContextKey({ ...baseContext, chineseTranslitMode: mode }).includes("mandarinEzaRevision"));
  }
});

test("processing context key changes when translation target changes", () => {
  assert.notEqual(
    buildProcessingContextKey(baseContext),
    buildProcessingContextKey({ ...baseContext, translationTargetLang: "vi" })
  );
});

test("processing context key changes when processing modes change", () => {
  const variants: ProcessingContext[] = [
    { ...baseContext, translationEnabled: false },
    { ...baseContext, chineseTranslitMode: "jyutping" },
    { ...baseContext, chineseTones: true },
    { ...baseContext, joinMandarinWords: true },
    { ...baseContext, chineseReadingPlacement: "wordBelow" },
    { ...baseContext, chineseReadingPlacement: "wordAbove" },
    { ...baseContext, chineseCharacterForm: "traditional" },
    { ...baseContext, koreanDisplayMode: "wordTranslit" },
    { ...baseContext, koreanDisplayMode: "rrPronunciation" },
    { ...baseContext, koreanDisplayMode: "vnPronunciation" },
    { ...baseContext, cyrillicRomanizationMode: "Ukrainian" },
    { ...baseContext, cyrillicKeepSigns: true },
    { ...baseContext, japaneseReadingMode: "furigana" },
  ];

  const baseKey = buildProcessingContextKey(baseContext);
  for (const variant of variants) {
    assert.notEqual(buildProcessingContextKey(variant), baseKey);
  }
});

test("disabled translation key ignores target language", () => {
  assert.equal(
    buildProcessingContextKey({
      ...baseContext,
      translationEnabled: false,
      translationTargetLang: "en",
    }),
    buildProcessingContextKey({
      ...baseContext,
      translationEnabled: false,
      translationTargetLang: "vi",
    })
  );
});

test("Korean display mode is part of processing context key", () => {
  assert.notEqual(
    buildProcessingContextKey({ ...baseContext, koreanDisplayMode: "rrStandard" }),
    buildProcessingContextKey({ ...baseContext, koreanDisplayMode: "wordTranslit" })
  );
  assert.notEqual(
    buildProcessingContextKey({ ...baseContext, koreanDisplayMode: "rrPronunciation" }),
    buildProcessingContextKey({ ...baseContext, koreanDisplayMode: "vnPronunciation" })
  );
});

test("auto language results and output styles invalidate the processing cache", () => {
  const key = (chineseTranslitMode: ProcessingContext["chineseTranslitMode"], resolvedChineseTranslitMode: ProcessingContext["resolvedChineseTranslitMode"]) =>
    buildProcessingContextKey({ ...baseContext, chineseTranslitMode, resolvedChineseTranslitMode });
  assert.notEqual(key("auto", "pinyin"), key("auto", "jyutping"));
  assert.notEqual(key("auto", "jyutping"), key("auto-vn", "jyutping-vn"));
  assert.notEqual(key("auto", "pinyin"), key("pinyin", "pinyin"));
  assert.match(key("auto-vn", "jyutping-vn"), /mandarinEzaRevision/);
  assert.match(key("auto", "pinyin"), /chineseAudioRevision/);
});

test("rhyme processing has its own revision and ignores unrelated audio decisions", () => {
  const key = (mode: "rhyme" | "rhyme-vn", resolved: "pinyin" | "jyutping") =>
    buildProcessingContextKey({ ...baseContext, chineseTranslitMode: mode, resolvedChineseTranslitMode: resolved });
  assert.equal(key("rhyme", "pinyin"), key("rhyme", "jyutping"));
  assert.notEqual(key("rhyme", "pinyin"), key("rhyme-vn", "pinyin"));
  assert.match(key("rhyme", "pinyin"), /chineseRhymeRevision/);
  assert.doesNotMatch(key("rhyme", "pinyin"), /chineseAudioRevision/);
  assert.match(key("rhyme-vn", "pinyin"), /mandarinEzaRevision/);
});
