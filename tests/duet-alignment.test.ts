import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const mainCss = readFileSync(new URL("../src/css/Lyrics/main.css", import.meta.url), "utf8");

test("opposite-aligned extras right-align the flex reading-plan row", () => {
  // With Adaptive Sectioning the romanization row is display:flex, which
  // ignores the line's text-align:end; without this rule duet partners'
  // romanization stays left while their translation right-aligns.
  assert.match(
    mainCss,
    /\.line\.HasOppositeAlignedExtras \.reading-plan-row\s*\{\s*justify-content: flex-end;/u
  );
});

test("reading-plan rows keep start alignment outside opposite lines", () => {
  const globalRow = mainCss.match(/\.LyricsContent \.reading-plan-row\s*\{[^}]*\}/u)?.[0] ?? "";
  assert.doesNotMatch(globalRow, /justify-content: flex-end/u);
});
