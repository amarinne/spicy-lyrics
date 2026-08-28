import assert from "node:assert/strict";
import test from "node:test";
import {
  createHanLanguageContext,
  resolveHanLanguageTag,
  splitHanLanguageRuns,
} from "../src/utils/Lyrics/HanLanguage.ts";

test("track language disambiguates Han-only Japanese and Chinese lines", () => {
  assert.equal(resolveHanLanguageTag("東方", "jpn", "ja"), "ja");
  assert.equal(resolveHanLanguageTag("东方", "cmn", "zh"), "zh-Hans");
  assert.equal(resolveHanLanguageTag("東方", "cmn", "zh"), "zh-Hant");
});

test("explicit conversion controls the Chinese language tag", () => {
  assert.equal(resolveHanLanguageTag("中文", "cmn", "zh", "simplified"), "zh-Hans");
  assert.equal(resolveHanLanguageTag("中文", "cmn", "zh", "traditional"), "zh-Hant");
});

test("mixed runs keep Latin neutral and route Kana separately", () => {
  const context = createHanLanguageContext(
    { Language: "cmn", LanguageISO2: "zh", ChineseCharacterForm: "simplified" },
    "Shout 风起かな",
    true,
    "Chinese",
  );
  assert.deepEqual(splitHanLanguageRuns("Shout 风起かな", context), [
    { text: "Shout ", language: null },
    { text: "风起", language: "zh-Hans" },
    { text: "かな", language: "ja" },
  ]);
});
