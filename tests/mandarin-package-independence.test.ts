import assert from "node:assert/strict";
import test from "node:test";
import { pinyin } from "pinyin-pro";
import { romanizeMandarin, buildMandarinWordLayout, joinMandarinReadingWords } from "../src/utils/Lyrics/Fork/Romanization.ts";
import { buildChineseAttachedReadings } from "../src/utils/Lyrics/Processing/ChineseReadingSegments.ts";
import { mandarinTimedChunks } from "../src/utils/Lyrics/Processing/ChineseTimedChunks.ts";
import { mandarinReaderDebug } from "../src/utils/Lyrics/Fork/MandarinReader.ts";

test("all Standard Pinyin display paths work without loading the model reader", () => {
  assert.equal(mandarinReaderDebug.telemetry().load, undefined);
  for (const source of ["看得见", "说说", "哥哥", "妳好", "暈開了結局", "你 mp3 好", "𠀀你😀好"]) {
    const points = Array.from(source);
    const expected = pinyin(source, { type: "array", toneSandhi: false, nonZh: "consecutive" }).join(" ").replace(/\s+/gu, " ").trim();
    assert.equal(romanizeMandarin(source), expected);
    assert.ok(buildMandarinWordLayout(source).tokens.length);
    assert.ok(joinMandarinReadingWords(source, expected));
    const spans = points.map((_, i) => ({ spanId: String(i), canonicalRange: { startCp: i, endCp: i + 1 } }));
    assert.ok(buildChineseAttachedReadings(source, "pinyin", true, spans).length);
    assert.ok(mandarinTimedChunks(source, points, "pinyin", true));
  }
  assert.equal(mandarinReaderDebug.telemetry().load, undefined);
});
