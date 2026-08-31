import assert from "node:assert/strict";
import { test } from "node:test";
import {
  furiganaContainedByTimingSpan,
  processJapanesePackageLine,
  processJapanesePackageTextTarget,
  timingSpanMergeRanges,
} from "../src/utils/Lyrics/Processing/Japanese/JapanesePackageProcessor.ts";

test("compound ruby crossing timing fragments merges only crossed words", () => {
  const ruby = [{ start: 0, end: 2, reading: "おぼつか", source: "jmdict" as const }];
  const spans = [
    { index: 0, start: 0, end: 1, rawText: "覚" },
    { index: 1, start: 1, end: 2, rawText: "束" },
    { index: 2, start: 2, end: 4, rawText: "なく" },
  ];
  assert.deepEqual(timingSpanMergeRanges("覚束なく", spans, ruby), [{ start: 0, end: 1 }]);
  assert.deepEqual(furiganaContainedByTimingSpan("覚束なく", { start: 0, end: 2 }, ruby), [{ start: 0, end: 2, reading: "おぼつか" }]);
});

test("jukujikun merge preserves unaffected timing words", async () => {
  const syllables = [
    { Text: "覚", StartTime: 100, EndTime: 200 },
    { Text: "束", StartTime: 200, EndTime: 300 },
    { Text: "なく", StartTime: 300, EndTime: 500 },
  ];
  const spans = [
    { index: 0, start: 0, end: 1, rawText: "覚" },
    { index: 1, start: 1, end: 2, rawText: "束" },
    { index: 2, start: 2, end: 4, rawText: "なく" },
  ];
  const result = await processJapanesePackageLine("覚束なく", syllables, spans, syllables);
  assert.deepEqual(syllables.map((item) => [item.Text, item.StartTime, item.EndTime]), [
    ["覚束", 100, 300],
    ["なく", 300, 500],
  ]);
  assert.deepEqual(result.plan.sourceUnits.map((unit) => unit.canonicalRange), [
    { startCp: 0, endCp: 2 },
    { startCp: 2, endCp: 4 },
  ]);
  assert.equal(result.plan.timedReadingUnits.length, 2);
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

test("Japanese package does not duplicate token reading across split timing spans", async () => {
  const texts = ["開", "い", "たばかりの", "花", "が", "散るのを"];
  const syllables = texts.map((Text, index) => ({ Text, StartTime: index, EndTime: index + 1 }));
  const spans = texts.map((rawText, index) => ({
    index,
    start: texts.slice(0, index).join("").length,
    end: texts.slice(0, index + 1).join("").length,
    rawText,
  }));
  const result = await processJapanesePackageLine(texts.join(""), syllables, spans, syllables);
  assert.deepEqual(result.plan.timedReadingUnits.map((unit) => unit.text), [
    "hirai", "", "ta bakari no", " hana", " ga", " chiru no wo",
  ]);
  assert.equal(result.plan.joinedDisplayText, "hiraita bakari no hana ga chiru no wo");
});

for (const [text, expected] of [
  ["曇りのち雨", "kumori no chi ame"],
  ["何から始める", "nani kara hajimeru"],
  ["4時", "yo ji"],
  ["2人", "futari"],
  ["明日", "ashita"],
  ["壊れたよこの世界で", "kowareta yo kono sekai de"],
  ["教えてよその仕組みを", "oshiete yo sono shikumi wo"],
  ["横の世界", "yoko no sekai"],
  ["余所の仕組み", "yoso no shikumi"],
  ["よこの世界", "yoko no sekai"],
  ["よその仕組み", "yoso no shikumi"],
] as const) {
  test(`Japanese package adapter exposes reading-policy v1.2: ${text}`, async () => {
    const target = { Text: text };
    assert.equal(await processJapanesePackageTextTarget(target), expected);
    assert.equal(target.ReadingRenderPlan?.joinedDisplayText, expected);
    assert.equal(target.RomanizedText, undefined);
    assert.equal(target.TransliteratedText, undefined);
  });
}
