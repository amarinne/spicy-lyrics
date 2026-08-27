import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const emphasizeSource = readFileSync(
  new URL("../src/utils/Lyrics/Applyer/Utils/Emphasize.ts", import.meta.url),
  "utf8"
);
const mixedCss = readFileSync(
  new URL("../src/css/Lyrics/Mixed.css", import.meta.url),
  "utf8"
);

test("animated internal whitespace keeps one timed letter and one visible gap", () => {
  assert.match(
    emphasizeSource,
    /if \(letter\.trim\(\)\.length === 0\) \{\s*letterElem\.classList\.add\("SpaceLetter"\);\s*\}/u
  );
  assert.match(
    mixedCss,
    /\.letter\.SpaceLetter\s*\{[^}]*white-space:\s*pre;[^}]*min-width:\s*0\.3ch;[^}]*\}/u
  );
});
