import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseTTML } from "../src/utils/Lyrics/ttml/parser.ts";

const parseSource = readFileSync(
  new URL("../src/utils/Lyrics/manager/parseTTML.ts", import.meta.url),
  "utf8"
);
const managerSource = readFileSync(
  new URL("../src/utils/Lyrics/manager/index.ts", import.meta.url),
  "utf8"
);

test("persistent TTML parsing is local and returns the direct parser shape", () => {
  const parsed = parseTTML(
    '<tt xmlns:itunes="http://itunes.apple.com/lyric-ttml-internal" itunes:timing="None"><body><div><p>Offline</p></div></body></tt>'
  );

  assert.deepEqual(parsed, { Type: "Static", Lines: [{ Text: "Offline" }] });
  assert.equal(parseTTML("<tt><body>"), null);
  assert.match(parseSource, /if \(typeof ttml !== "string"\) return null/u);
  assert.match(parseSource, /return parseTTML\(ttml\)/u);
  assert.doesNotMatch(parseSource, /Query|operation:\s*["']parseTTML/u);
});

test("LocalLyricsManager preserves raw storage and adds ldb source only after parse success", () => {
  assert.match(managerSource, /db\.put\(objStore, ttml, uri\)/u);
  assert.match(managerSource, /const parsed = ParseTTML\(data\)/u);
  assert.match(managerSource, /Object\.assign\(\{\}, parsed, \{ source: "ldb" \}\)/u);

  const getBody = managerSource.slice(
    managerSource.indexOf("async function get(uri"),
    managerSource.indexOf("async function listKeys")
  );
  assert.doesNotMatch(getBody, /db\.delete|remove\(/u);
});
