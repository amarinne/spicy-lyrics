import assert from "node:assert/strict";
import { test } from "node:test";

const storage = new Map<string, string>();
(globalThis as any).window = globalThis;
(globalThis as any).document = { querySelector: () => null };
(globalThis as any).MutationObserver = class {
  observe(): void {}
  disconnect(): void {}
};
(globalThis as any).Spicetify = {
  LocalStorage: {
    get: (key: string) => storage.get(key) ?? null,
    set: (key: string, value: string) => storage.set(key, value),
  },
};

const { formatLyricsForCopy } = await import("../src/utils/Lyrics/CopyLyrics.ts");

const plan = (reading: string) => ({ joinedDisplayText: reading });

test("transliteration mode appends the render-plan reading", () => {
  const lyrics = {
    Type: "Static",
    Lines: [
      { Text: "你好", ReadingRenderPlan: plan("nỉ hảo") },
      { Text: "Hello", ReadingRenderPlan: plan("Hello") },
      { Text: "再见" },
    ],
  };
  assert.equal(
    formatLyricsForCopy(lyrics, "transliteration"),
    "你好\nnỉ hảo\nHello\n再见"
  );
  // Other modes are unaffected.
  assert.equal(formatLyricsForCopy(lyrics, "plain"), "你好\nHello\n再见");
});

test("transliteration mode falls back to legacy romanized fields", () => {
  const lyrics = {
    Type: "Line",
    Content: [
      { Text: "한국어", StartTime: 1.5, RomanizedText: "hangugeo" },
      { Text: "사랑", StartTime: 5, TransliteratedText: "sarang" },
    ],
  };
  assert.equal(
    formatLyricsForCopy(lyrics, "transliteration"),
    "한국어\nhangugeo\n사랑\nsarang"
  );
});

test("transliteration mode covers syllable leads and backgrounds", () => {
  const lyrics = {
    Type: "Syllable",
    Content: [
      {
        Lead: {
          Syllables: [{ Text: "그대" }],
          ReadingRenderPlan: plan("gưdê"),
        },
        Background: [
          {
            Syllables: [{ Text: "아무런" }],
            ReadingRenderPlan: plan("amuron"),
          },
        ],
      },
    ],
  };
  assert.equal(
    formatLyricsForCopy(lyrics, "transliteration"),
    "그대\ngưdê\n아무런\namuron"
  );
});

test("transliteration identical to source is not duplicated", () => {
  const lyrics = {
    Type: "Static",
    Lines: [{ Text: "Hello", RomanizedText: "Hello" }],
  };
  assert.equal(formatLyricsForCopy(lyrics, "transliteration"), "Hello");
});
