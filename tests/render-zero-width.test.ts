import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { StripZeroWidth } from "../src/utils/Lyrics/Applyer/Utils/StripZeroWidth.ts";

test("render cleaner removes non-semantic markers and preserves shaping controls", () => {
  assert.equal(StripZeroWidth("a\u200Bb\u200Ec\u200Fd\u2060e\uFEFFf"), "abcdef");
  assert.equal(StripZeroWidth("a\u200Cb\u200Dc"), "a\u200Cb\u200Dc");
});

test("syllable rendering cleans before letter timing split", () => {
  const source = readFileSync(
    new URL("../src/utils/Lyrics/Applyer/Synced/Syllable.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /const renderText = StripZeroWidth\(syllable\.Text \|\| ""\);/u);
  assert.match(source, /Emphasize\(renderText\.split\(""\), word, syllable, isBackground\);/u);
  assert.doesNotMatch(source, /Emphasize\(syllable\.Text\.split\(""\)/u);
});
