import assert from "node:assert/strict";
import { test } from "node:test";
import {
  furiganaContainedByTimingSpan,
  processJapanesePackageLine,
} from "../src/utils/Lyrics/Processing/Japanese/JapanesePackageProcessor.ts";

test("compound ruby crossing timing fragments stays line-level", () => {
  const ruby = [{ start: 0, end: 2, reading: "おぼつか", source: "jmdict" as const }];
  assert.deepEqual(furiganaContainedByTimingSpan("覚束なく", { start: 0, end: 1 }, ruby), []);
  assert.deepEqual(furiganaContainedByTimingSpan("覚束なく", { start: 1, end: 4 }, ruby), []);
  assert.deepEqual(furiganaContainedByTimingSpan("覚束なく", { start: 0, end: 4 }, ruby), [{ start: 0, end: 2, reading: "おぼつか" }]);
});

test("Japanese package preserves TTML Latin-to-Japanese whitespace", async () => {
  const texts = ["I ", "let ", "you ", "go ", "君のた", "めなら"];
  const syllables = texts.map((Text, index) => ({ Text, StartTime: index, EndTime: index + 1 }));
  const spans = texts.map((rawText, index) => ({
    index,
    start: texts.slice(0, index).join("").length,
    end: texts.slice(0, index + 1).join("").length,
    rawText,
  }));
  const displayText = texts.join("");
  const result = await processJapanesePackageLine(displayText, syllables, spans, syllables);
  assert.equal(displayText, "I let you go 君のためなら");
  assert.equal(result.romaji, "I let you go kimi no tame nara");
});
