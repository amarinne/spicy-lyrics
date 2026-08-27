import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(
  new URL(
    "../src/components/ReactComponents/LyricsManager/components/UploadTTMLModal.tsx",
    import.meta.url
  ),
  "utf8"
);

test("temporary TTML upload consumes the direct local parser result without storage", () => {
  assert.match(source, /const result = ParseTTML\(ttml\)/u);
  assert.doesNotMatch(source, /await ParseTTML|result\?\.Result/u);

  const temporaryBranch = source.slice(
    source.indexOf('toast("Found TTML, Parsing..."'),
    source.indexOf("} catch (err)")
  );
  assert.doesNotMatch(temporaryBranch, /LocalLyricsManager\.put/u);
  assert.match(temporaryBranch, /const dataToSave = \{\s*\.\.\.result,\s*uri,/u);
});

test("temporary parse failure returns before processing or publication", () => {
  const parseIndex = source.indexOf("const result = ParseTTML(ttml)");
  const failureIndex = source.indexOf("if (!result)", parseIndex);
  const returnIndex = source.indexOf("return;", failureIndex);
  const snapshotIndex = source.indexOf("captureOriginalSnapshot", failureIndex);
  const processIndex = source.indexOf("await ProcessLyrics", failureIndex);
  const publishIndex = source.indexOf('onDone("temporary")', failureIndex);

  assert.ok(parseIndex >= 0 && failureIndex > parseIndex);
  assert.ok(returnIndex > failureIndex);
  assert.ok(snapshotIndex > returnIndex);
  assert.ok(processIndex > returnIndex);
  assert.ok(publishIndex > returnIndex);
  assert.match(source, /if \(mode === "persistent"\) \{\s*await LocalLyricsManager\.put\(uri, ttml\)/u);
});
