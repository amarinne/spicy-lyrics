import assert from "node:assert/strict";
import { test } from "node:test";
import {
  batchTranslate,
  buildBatchChunks,
  buildBatchQuery,
  extractGoogleRomanization,
  looksLikeRomanizationEcho,
  parseBatchTranslation,
  shouldTranslateLine,
  stripMarkerEcho,
  TRANSLATION_BATCH_MAX_CHARS,
  TRANSLATION_BATCH_MAX_LINES,
} from "../src/utils/Lyrics/Fork/Translation.ts";

test("Google dt=rm response extracts its dedicated pronunciation field", () => {
  assert.equal(extractGoogleRomanization([[[null, null, null, "S̄wạs̄dī"]], null, "th"]), "S̄wạs̄dī");
  assert.equal(extractGoogleRomanization([[['hello', 'สวัสดี', null, null]]]), "");
});

test("marker batch query parses translated response back to source indices", () => {
  assert.equal(
    buildBatchQuery(["line one", "line two", "line three"]),
    "[[SPX_000]] line one\n[[SPX_001]] line two\n[[SPX_002]] line three"
  );

  const parsed = parseBatchTranslation(
    "[[SPX_000]] ligne un\n[[ spx _ 0 0 1 ]] ligne deux\n[[SPX_002]] ligne trois"
  );

  assert.equal(parsed.get(0), "ligne un");
  assert.equal(parsed.get(1), "ligne deux");
  assert.equal(parsed.get(2), "ligne trois");
});

test("batch chunking respects line and character limits", () => {
  const lineLimited = buildBatchChunks(Array.from({ length: TRANSLATION_BATCH_MAX_LINES + 1 }, (_, i) => `line ${i}`));
  assert.equal(lineLimited.length, 2);
  assert.equal(lineLimited[0].lines.length, TRANSLATION_BATCH_MAX_LINES);
  assert.equal(lineLimited[1].lines.length, 1);
  assert.equal(lineLimited[1].start, TRANSLATION_BATCH_MAX_LINES);

  const almostFull = "x".repeat(TRANSLATION_BATCH_MAX_CHARS - 14);
  const charLimited = buildBatchChunks([almostFull, "next"]);
  assert.equal(charLimited.length, 2);
  assert.deepEqual(charLimited.map((chunk) => chunk.lines.length), [1, 1]);
  assert.equal(charLimited[1].query, "[[SPX_000]] next");
});

test("marker echoes are stripped from parsed output", () => {
  assert.equal(stripMarkerEcho("[[SPX_003]] translated line", 3), "translated line");
  assert.equal(stripMarkerEcho("translated [[ spx _ 0 0 3 ]] line", 3), "translated  line");
});

test("translation guard rejects Cyrillic romanization echoes", () => {
  assert.equal(looksLikeRomanizationEcho("Алдадыңбы,", "Aldadynby,"), true);
  assert.equal(looksLikeRomanizationEcho("Алдадыңбы,", "did you cheat"), false);
});

test("translation guard rejects Korean romanization echoes", () => {
  assert.equal(looksLikeRomanizationEcho("사랑", "sarang"), true);
  assert.equal(looksLikeRomanizationEcho("좋고", "jôkô"), true);
});

test("English target translates short Latin lyric-looking lines", () => {
  assert.equal(shouldTranslateLine("Apna bana le piya", "eng", "en"), true);
  assert.equal(shouldTranslateLine("yeah", "eng", "en"), false);
});

test("batch translation retries romanization echoes once individually", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (url: URL | RequestInfo) => {
    requests.push(String(url));
    const translated = requests.length === 1
      ? "[[SPX_000]] Aldadynby,"
      : "did you cheat";
    return {
      ok: true,
      json: async () => [[[translated]]],
    } as Response;
  };

  try {
    assert.deepEqual(await batchTranslate(["Алдадыңбы,"], "und", "en"), ["did you cheat"]);
    assert.equal(requests.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
