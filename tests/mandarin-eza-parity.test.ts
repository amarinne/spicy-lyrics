import assert from "node:assert/strict";
import { before, test } from "node:test";
import { ensureMandarinSegmenter } from "../src/utils/Lyrics/Fork/MandarinEzaLine.ts";
import { segmentMandarinLine } from "../src/utils/Lyrics/Fork/MandarinReader.ts";
import { romanizeMandarinVn } from "../src/utils/Lyrics/Fork/Romanization.ts";

before(async () => { assert.equal(await ensureMandarinSegmenter(), true); });

// Integration checks for Mandarin eza式 revision 3. The parity corpus asserts the exact eza strings;
// these keep the segmenter contract and the public romanization route honest.

test("the public romanization route spells revision-3 surface tones", () => {
  assert.equal(romanizeMandarinVn("展览馆"), "zhán lán kuản");
  assert.equal(romanizeMandarinVn("纸老虎"), "zhử láo hủ");
  assert.equal(romanizeMandarinVn("看看"), "khan khàn");
  assert.equal(romanizeMandarinVn("说说"), "shuo shuò");
  assert.equal(romanizeMandarinVn("老总好看"), "láo zóng hảo khàn");
  // Layer 3 flattens tone 4 before tone 4 across word boundaries.
  assert.equal(romanizeMandarinVn("去看"), "chyu khàn");
  assert.equal(romanizeMandarinVn("在这"), "zai zhừa");
  assert.equal(romanizeMandarinVn("是的"), "shư tờ");
  // A neutral after tone 1 falls; after a full-vowel tone 2 it takes the hook.
  assert.equal(romanizeMandarinVn("妈妈"), "ma mà");
  assert.equal(romanizeMandarinVn("爷爷"), "yé yẻ");
  assert.equal(romanizeMandarinVn("朋友"), "pấng yỏu");
});

test("the shared portable segmenter preserves feet, tags and code-point ranges", () => {
  for (const source of ["展览馆", "暈開了結局", "他说的确实在理", "妳好 😀 BTS4!", "𠀀你\n好"]) {
    const tokens = segmentMandarinLine(source);
    assert.equal(tokens.map((token) => token.text).join(""), source);
    const points = Array.from(source);
    for (const token of tokens) {
      assert.equal(points.slice(token.range.start, token.range.end).join(""), token.text);
      for (const piece of token.subwords) assert.ok(token.text.includes(piece));
    }
  }
  const particles = segmentMandarinLine("他说的确实在理");
  assert.equal(particles.find((token) => token.text === "的")?.tag, "uj");
  assert.deepEqual(segmentMandarinLine("暈開了結局").map((token) => token.text), ["暈開", "了", "結局"]);
});
