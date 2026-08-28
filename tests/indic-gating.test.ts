import assert from "node:assert/strict";
import { test } from "node:test";
import { hasIndicScript } from "../src/utils/Lyrics/Fork/TextDetection.ts";
import { shouldTranslateLine } from "../src/utils/Lyrics/Fork/Translation.ts";

test("detects supported Indic scripts", () => {
  assert.equal(hasIndicScript("ओ सनम, ओ जिगर, तुमको हो क्या ही खबर"), true);
  assert.equal(hasIndicScript("ਹੋ ਇਸ਼ਕ ਬੇਪਰਵਾਹ"), true);
  assert.equal(hasIndicScript("Tu mera koi na hoke"), false);
  assert.equal(hasIndicScript("好き、嫌い"), false);
});

test("gates Indic script translation by target language", () => {
  assert.equal(shouldTranslateLine("ओ सनम, ओ जिगर, तुमको हो क्या ही खबर", "hin", "en"), true);
  assert.equal(shouldTranslateLine("ओ सनम, ओ जिगर, तुमको हो क्या ही खबर", "hin", "hi"), false);
  assert.equal(shouldTranslateLine("ਹੋ ਇਸ਼ਕ ਬੇਪਰਵਾਹ", "pan", "en"), true);
  assert.equal(shouldTranslateLine("ਹੋ ਇਸ਼ਕ ਬੇਪਰਵਾਹ", "pan", "pa"), false);
});
