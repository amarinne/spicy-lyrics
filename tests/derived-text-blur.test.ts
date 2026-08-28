import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const mainCss = readFileSync(
  new URL("../src/css/Lyrics/main.css", import.meta.url),
  "utf8"
).replace(/\r\n/gu, "\n");

function ruleBody(selector: string): string {
  const selectorStart = mainCss.indexOf(selector);
  assert.notEqual(selectorStart, -1, `missing CSS selector: ${selector}`);
  const bodyStart = mainCss.indexOf("{", selectorStart);
  const bodyEnd = mainCss.indexOf("}", bodyStart);
  assert.notEqual(bodyStart, -1, `missing CSS body: ${selector}`);
  assert.notEqual(bodyEnd, -1, `unterminated CSS body: ${selector}`);
  return mainCss.slice(bodyStart + 1, bodyEnd);
}

test("derived lyric rows scale the owning line blur exactly once", () => {
  const line = ruleBody("#SpicyLyricsPage .LyricsContainer .LyricsContent .line");
  assert.match(
    line,
    /--DerivedTextBlurAmount:\s*clamp\(0px,\s*calc\(var\(--BlurAmount,\s*0px\)\s*\*\s*0\.46\),\s*3\.25px\)/u
  );

  assert.match(
    ruleBody("#SpicyLyricsPage .LyricsContainer .LyricsContent .furigana-reading"),
    /--FuriganaBlurAmount:\s*var\(--DerivedTextBlurAmount,\s*0px\);[\s\S]*?filter:\s*blur\(var\(--FuriganaBlurAmount\)\)/u
  );
  assert.match(
    ruleBody("#SpicyLyricsPage .LyricsContainer .LyricsContent .romanized-below"),
    /--RomanizedSidecarBlurAmount:\s*var\(--DerivedTextBlurAmount,\s*0px\);[\s\S]*?filter:\s*blur\(var\(--RomanizedSidecarBlurAmount\)\)/u
  );
  assert.match(
    ruleBody("#SpicyLyricsPage .LyricsContainer .LyricsContent .translated-below"),
    /--TranslatedSidecarBlurAmount:\s*var\(--DerivedTextBlurAmount,\s*0px\);[\s\S]*?filter:\s*blur\(var\(--TranslatedSidecarBlurAmount\)\)/u
  );
  assert.doesNotMatch(
    ruleBody(
      "#SpicyLyricsPage .LyricsContainer .LyricsContent .romanized-below .romanized-syllable"
    ),
    /filter:\s*blur/u
  );
});
