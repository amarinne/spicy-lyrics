import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import {
  ensureMandarinSegmenter,
  mandarinEzaReadings,
  setMandarinNeutralWords,
} from "../src/utils/Lyrics/Fork/MandarinEzaLine.ts";
import { MANDARIN_EZA_REVISION } from "../src/utils/Lyrics/Fork/MandarinEzaSandhi.ts";
import { convertMandarinSyllableToVnAid } from "../src/utils/Lyrics/Fork/MandarinVnAid.ts";
import { romanizeMandarin, romanizeMandarinVn } from "../src/utils/Lyrics/Fork/Romanization.ts";
import { convert } from "pinyin-pro";

// Cross-app parity for Mandarin eza式 revision 2. The corpus comes from the cjk-labs reference
// (see `provenance` in the fixture). Each case joins Han syllables with one space and keeps other
// text (punctuation, line breaks) as written, the same layout as the reference comparison column.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/eza-rev2-parity.json", import.meta.url), "utf8")) as {
  schema: string;
  policy: string;
  cases: { source: string; pinyin: string; eza: string; ezaWithCcCedict?: string }[];
};

function layout(text: string, spell: (citation: string, surface: string) => string): string {
  let out = "";
  let previousZh = false;
  for (const item of mandarinEzaReadings(text)) {
    if (item.isZh) out += (previousZh ? " " : "") + spell(item.citation, item.surface);
    else out += item.origin;
    previousZh = item.isZh;
  }
  return out;
}

before(async () => {
  assert.equal(await ensureMandarinSegmenter(), true, "jieba-wasm loads");
});
after(() => setMandarinNeutralWords(undefined));

test("the Mandarin eza式 revision 2 parity corpus matches the reference without a dictionary", () => {
  assert.equal(fixture.schema, "cjk-labs.eza-rev2-parity.v1");
  assert.equal(fixture.policy, MANDARIN_EZA_REVISION);
  assert.equal(fixture.cases.length, 104);
  const diverged = fixture.cases.flatMap((item) => {
    const eza = layout(item.source, (_, surface) => convertMandarinSyllableToVnAid(surface));
    return eza === item.eza ? [] : [`${JSON.stringify(item.source)}: ${eza} != ${item.eza}`];
  });
  assert.deepEqual(diverged, []);
});

test("Standard Pinyin keeps the citation reading for every parity case", () => {
  for (const item of fixture.cases) {
    const pinyin = layout(item.source, (citation) => convert(citation, { format: "numToSymbol" }));
    assert.equal(pinyin, item.pinyin, JSON.stringify(item.source));
  }
  assert.equal(romanizeMandarin("我很好"), "wǒ hěn hǎo");
  assert.equal(romanizeMandarin("妹妹"), "mèi mei");
});

test("jieba subwords and verb tags reach the sandhi rules", () => {
  assert.equal(romanizeMandarinVn("展览馆"), "zhán lán kuản", "subwords group 展览|馆");
  assert.equal(romanizeMandarinVn("纸老虎"), "zhử láo hủ", "subwords group 纸|老虎");
  assert.equal(romanizeMandarinVn("看看"), "khan khàn", "a verb repeated once: the second syllable is neutral and falls");
  assert.equal(romanizeMandarinVn("说说"), "shuo shuo", "jieba cuts 说|说, so there is no reduplicated verb token");
  assert.equal(romanizeMandarinVn("老总好看"), "láo zỏng hảo khàn", "two feet never merge");
});

test("the bundle inlines the jieba wasm instead of fetching it", () => {
  const spiceConfig = readFileSync(new URL("../spice.config.ts", import.meta.url), "utf8");
  const line = readFileSync(new URL("../src/utils/Lyrics/Fork/MandarinEzaLine.ts", import.meta.url), "utf8");
  assert.match(spiceConfig, /filter: \/\^jieba-wasm-bytes\$\/ \}/u);
  assert.match(spiceConfig, /jieba-wasm\/pkg\/web\/jieba_rs_wasm_bg\.wasm/u);
  assert.match(spiceConfig, /loader: \{ "\.wasm": "binary" \}/u);
  assert.match(spiceConfig, /plugins: \[[^\]]*inlineJiebaWasm/u);
  assert.match(line, /module_or_path: bytes/u);
});

test("dictionary neutral flags change the eza式 layer only", () => {
  setMandarinNeutralWords(new Map([
    ["朋友|peng you", [1]],
    ["值得|zhi de", [1]],
    ["一个|yi ge", [1]],
  ]));
  try {
    assert.equal(romanizeMandarinVn("朋友"), "pấng you", "the neutral 友 is level after tone 2");
    assert.equal(romanizeMandarinVn("值得"), "zhứ tơ", "the neutral e reduces to ơ");
    assert.equal(romanizeMandarinVn("一个人"), "yí kưa rấn", "一 before a neutral is tone 2, and the neutral after it is level");
    assert.equal(romanizeMandarinVn("东西"), "tong shi", "a word the overlay does not list keeps the provider's tones");
    assert.equal(romanizeMandarin("朋友"), "péng yǒu", "Standard Pinyin keeps the provider's tones");
  } finally {
    setMandarinNeutralWords(undefined);
  }
  assert.equal(romanizeMandarinVn("朋友"), "pấng yỏu", "without the overlay the provider's tones stand");
});

// Internal reference data (owner 2026-11-13): the `ezaWithCcCedict` column needs the locally generated neutral-word list
// (`node tools/generate-mandarin-neutral-words.mjs <cedict>`, gitignored). Without it the test skips.
const neutralWordsPath = new URL("../tools/.cache/mandarin-neutral-words.json", import.meta.url);
test("with the local CC-CEDICT neutral words, the parity corpus matches the reference dictionary column", { skip: existsSync(neutralWordsPath) ? false : "no local neutral-word data" }, () => {
  setMandarinNeutralWords(new Map(Object.entries(JSON.parse(readFileSync(neutralWordsPath, "utf8")) as Record<string, number[]>)));
  try {
    const diverged = fixture.cases.flatMap((item) => {
      const eza = layout(item.source, (_, surface) => convertMandarinSyllableToVnAid(surface));
      const want = item.ezaWithCcCedict ?? item.eza;
      return eza === want ? [] : [`${JSON.stringify(item.source)}: ${eza} != ${want}`];
    });
    assert.deepEqual(diverged, []);
  } finally {
    setMandarinNeutralWords(undefined);
  }
});
