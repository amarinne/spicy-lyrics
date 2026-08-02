import assert from "node:assert/strict";
import test from "node:test";
import {
  convertChineseLyricsText,
  convertChineseText,
  convertChineseTimedTextUnits,
  detectChineseCharacterForm,
} from "../src/utils/Lyrics/ChineseCharacterConversion.ts";

test("converts between Simplified and Taiwan Traditional forms", () => {
  assert.equal(convertChineseText("漢語", "simplified"), "汉语");
  assert.equal(convertChineseText("汉语", "traditional"), "漢語");
  assert.equal(convertChineseText("漢語", "original"), "漢語");
});

test("detects form only when text provides useful evidence", () => {
  assert.equal(detectChineseCharacterForm("汉语"), "simplified");
  assert.equal(detectChineseCharacterForm("漢語"), "traditional");
  assert.equal(detectChineseCharacterForm("中文"), "ambiguous");
});

test("converts a complete timed phrase without changing timing", () => {
  const units = [
    { Text: "头", StartTime: 1, EndTime: 2, IsPartOfWord: true },
    { Text: "发", StartTime: 2, EndTime: 3, IsPartOfWord: true },
  ];
  assert.deepEqual(convertChineseTimedTextUnits(units, "traditional"), ["頭", "髮"]);
  assert.deepEqual(units.map(({ StartTime, EndTime }) => ({ StartTime, EndTime })), [
    { StartTime: 1, EndTime: 2 },
    { StartTime: 2, EndTime: 3 },
  ]);
});

test("converts primary lyrics without touching translations", () => {
  const lyrics = {
    Type: "Line",
    Content: [
      { Text: "汉语", TranslatedText: "Chinese" },
      { Text: "君の声", TranslatedText: "voice" },
    ],
  };
  convertChineseLyricsText(lyrics, "traditional", (text) => !text.includes("の"));
  assert.equal(lyrics.Content[0].Text, "漢語");
  assert.equal(lyrics.Content[0].TranslatedText, "Chinese");
  assert.equal(lyrics.Content[1].Text, "君の声");
});
