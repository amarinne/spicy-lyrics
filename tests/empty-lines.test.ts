import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HasLyricsText,
  HasRenderableText,
  IsEmptyLyrics,
  IsEmptyLyricsLine,
  RemoveEmptyLyricsLines,
  StripEmptyLyricsLines,
} from "../src/utils/Lyrics/EmptyLines.ts";

test("HasLyricsText ignores blank and zero-width-only text", () => {
  assert.equal(HasLyricsText("hello"), true);
  assert.equal(HasLyricsText("  "), false);
  assert.equal(HasLyricsText("\u200B\uFEFF"), false);
  assert.equal(HasLyricsText(""), false);
  assert.equal(HasLyricsText(undefined), false);
});

test("HasRenderableText keeps entries whose only content is a romanization", () => {
  assert.equal(HasRenderableText({ Text: "", TransliteratedText: "romaji" }), true);
  assert.equal(HasRenderableText({ Text: "   ", TransliteratedText: "" }), false);
  assert.equal(HasRenderableText(undefined), false);
});

test("IsEmptyLyricsLine judges by renderable text, not just source text", () => {
  assert.equal(IsEmptyLyricsLine({ Text: "" }), true);
  assert.equal(IsEmptyLyricsLine({ Text: "", TransliteratedText: "ro" }), false);
  assert.equal(
    IsEmptyLyricsLine({ Lead: { Syllables: [{ Text: "" }, { Text: "a" }] } }),
    false
  );
  assert.equal(
    IsEmptyLyricsLine({ Lead: { Syllables: [{ Text: "" }] } }),
    true
  );
});

test("RemoveEmptyLyricsLines drops blanks and returns [] for a missing array", () => {
  const lines = RemoveEmptyLyricsLines([
    { Text: "a" },
    { Text: "" },
    { Text: "", TransliteratedText: "ro" },
  ]);
  assert.deepEqual(lines, [{ Text: "a" }, { Text: "", TransliteratedText: "ro" }]);
  assert.deepEqual(RemoveEmptyLyricsLines(undefined), []);
});

test("StripEmptyLyricsLines prunes lines, syllables and empty background groups", () => {
  const lyrics = {
    Type: "Syllable",
    Content: [
      { Lead: { Syllables: [{ Text: "a" }, { Text: "  " }] } },
      { Lead: { Syllables: [{ Text: "" }] } },
      {
        Lead: { Syllables: [{ Text: "b" }] },
        Background: [{ Syllables: [{ Text: "" }] }],
      },
    ],
  };

  StripEmptyLyricsLines(lyrics);

  assert.equal(lyrics.Content.length, 2);
  assert.deepEqual(lyrics.Content[0].Lead.Syllables, [{ Text: "a" }]);
  assert.equal("Background" in lyrics.Content[1], false);
});

test("IsEmptyLyrics only reports unrecognised-free payloads as empty", () => {
  assert.equal(IsEmptyLyrics({ Lines: [] }), true);
  assert.equal(IsEmptyLyrics({ Content: [] }), true);
  assert.equal(IsEmptyLyrics({ Lines: [{ Text: "a" }] }), false);
  assert.equal(IsEmptyLyrics(undefined), true);
  assert.equal(IsEmptyLyrics({ Type: "Static" }), false);
});
