import { pinyin } from "pinyin-pro";
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { ensureMandarinSegmenter, mandarinEzaReadings } from "../src/utils/Lyrics/Fork/MandarinEzaLine.ts";
import { readMandarinLine } from "../src/utils/Lyrics/Fork/MandarinReader.ts";
import { formatPinyin } from "../src/utils/Lyrics/Fork/MandarinPinyinFormat.ts";
import { romanizeMandarin, buildMandarinWordLayout } from "../src/utils/Lyrics/Fork/Romanization.ts";
import { buildChineseAttachedReadings } from "../src/utils/Lyrics/Processing/ChineseReadingSegments.ts";
import { mandarinTimedChunks } from "../src/utils/Lyrics/Processing/ChineseTimedChunks.ts";

before(async () => { assert.equal(await ensureMandarinSegmenter(), true); });
const probes = ["睡得着", "想得睡不着", "说说", "暈開了結局", "他说的确实在理", "去不了", "种在心中", "数一数", "只不过", "一个人"];

test("the model reader preserves source code points and syllable boundaries", () => {
  for (const source of [...probes, "妳好 😀 BTS4!", "𠀀你\n好", "A 你 mp3 好 B"]) {
    const line = readMandarinLine(source);
    const points = Array.from(source);
    assert.equal(line.syllables.length, points.length);
    for (const [index, item] of line.syllables.entries()) {
      assert.equal(item.index, index);
      assert.equal(item.char, points[index]);
      if (item.status === "reading") assert.match(item.raw, /^[a-züê]+[1-5]$/u);
    }
    assert.equal(mandarinEzaReadings(source).map((item) => item.origin).join(""), source);
    for (const token of buildMandarinWordLayout(source).tokens) {
      assert.equal(points.slice(token.startCp, token.endCp).join(""), token.text);
    }
  }
});

test("Standard Pinyin displays plain package output independently of model readings", () => {
  for (const source of [...probes, "变得", "哥哥", "我的哥哥", "妳好"]) {
    for (const tones of [true, false]) assert.equal(romanizeMandarin(source, tones), pinyin(source, {
      type: "array", toneType: tones ? "symbol" : "none", toneSandhi: false, nonZh: "consecutive",
    }).join(" ").replace(/\s+/gu, " ").trim());
  }
  assert.notEqual(romanizeMandarin("说说"), readMandarinLine("说说").syllables.map((item) => item.status === "reading" ? item.display : item.char).join(" "));
  assert.equal(formatPinyin("de5"), "de");
  assert.equal(formatPinyin("lü4"), "lǜ");
});

test("reviewed boundary regressions have the selected per-character readings", () => {
  for (const [source, expected] of [
    ["睡得着", ["shui4", "de5", "zhao2"]],
    ["说说", ["shuo1", "shuo5"]],
    ["暈開了結局", ["yun1", "kai1", "le5", "jie2", "ju2"]],
    ["他说的确实在理", ["ta1", "shuo1", "de5", "que4", "shi2", "zai4", "li3"]],
  ] as const) {
    assert.deepEqual(readMandarinLine(source).syllables.map((item) => item.status === "reading" ? item.raw : null), expected);
  }
});

test("plain, attached and timed Pinyin use the same whole-line reading", () => {
  for (const source of [...probes, "我的哥哥", "你 mp3 好"]) {
    const points = Array.from(source);
    const spans = points.map((_, i) => ({ spanId: String(i), canonicalRange: { startCp: i, endCp: i + 1 } }));
    const attached = buildChineseAttachedReadings(source, "pinyin", true, spans);
    const expected = new Map(pinyin(source, {type: "all", toneSandhi: false}).map((item, index) => [index, item] as const).filter(([, item]) => item.isZh).map(([index, item]) => [index, item.result]));
    for (const entry of attached) assert.equal(entry.reading, expected.get(entry.canonicalRange.startCp));
    const timed = mandarinTimedChunks(source, points, "pinyin", true)!;
    for (const [index, reading] of expected) assert.equal(timed[index], reading);
    for (const [index, reading] of expected) assert.ok(attached.some((entry) => entry.canonicalRange.startCp === index && entry.reading === reading));
  }
});
