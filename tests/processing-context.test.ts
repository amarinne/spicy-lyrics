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
