import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, test } from "node:test";
import { ensureMandarinSegmenter, mandarinEzaReadings } from "../src/utils/Lyrics/Fork/MandarinEzaLine.ts";
import { MANDARIN_EZA_REVISION } from "../src/utils/Lyrics/Fork/MandarinEzaSandhi.ts";
import { convertMandarinSyllableToVnAid } from "../src/utils/Lyrics/Fork/MandarinVnAid.ts";
import { pinyin as packagePinyin } from "pinyin-pro";
import { romanizeMandarinVn } from "../src/utils/Lyrics/Fork/Romanization.ts";

// Historical reading outputs stay unchanged as the comparison baseline. CPP labels and the
// private song comparison measure the replacement reader; the old engine is not its oracle.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/eza-rev2-parity.json", import.meta.url), "utf8"));
before(async () => { assert.equal(await ensureMandarinSegmenter(), true); });

test("all 112 historical parity lines retain their source and readable Han coverage", (t) => {
  assert.equal(fixture.schema, "cjk-labs.eza-rev2-parity.v1");
  assert.equal(fixture.policy, MANDARIN_EZA_REVISION);
  assert.equal(fixture.cases.length, 112);
  let pinyinChanged = 0;
  let ezaChanged = 0;
  for (const row of fixture.cases) {
    const items = mandarinEzaReadings(row.source);
    assert.equal(items.map((item) => item.origin).join(""), row.source);
    assert.equal(items.filter((item) => item.isZh).length, Array.from(row.source).filter((point) => /\p{Script=Han}/u.test(point)).length);
    const packageItems = packagePinyin(row.source, { type: "all", toneSandhi: false });
    let packageOffset = 0;
    const packageByPosition = new Map(packageItems.map((item) => { const at = packageOffset; packageOffset += Array.from(item.origin).length; return [at, item.result]; }));
    let pinyin = "", eza = "", previousHan = false;
    for (const item of items) {
      if (item.isZh) {
        assert.match(item.citation, /^[a-züê]+[1-5]$/u);
        assert.match(item.surface, /^[a-züê]+[0-6]$/u);
        pinyin += (previousHan ? " " : "") + packageByPosition.get(item.startCp);
        eza += (previousHan ? " " : "") + convertMandarinSyllableToVnAid(item.surface);
      } else { pinyin += item.origin; eza += item.origin; }
      previousHan = item.isZh;
    }
    pinyinChanged += Number(pinyin !== row.pinyin);
    ezaChanged += Number(eza !== row.eza);
  }
  t.diagnostic(JSON.stringify({ compared: 112, pinyinChanged, ezaChanged }));
});

test("jieba feet still reach frozen sandhi and phrase neutrals reach verb repeats", () => {
  assert.equal(romanizeMandarinVn("展览馆"), "zhán lán kuản");
  assert.equal(romanizeMandarinVn("纸老虎"), "zhử láo hủ");
  assert.equal(romanizeMandarinVn("看看"), "khan khàn");
  assert.equal(romanizeMandarinVn("说说"), "shuo shuò");
  assert.equal(romanizeMandarinVn("老总好看"), "láo zỏng hảo khàn");
});

test("the bundle inlines the jieba wasm instead of fetching it", () => {
  const config = readFileSync(new URL("../spice.config.ts", import.meta.url), "utf8");
  const line = readFileSync(new URL("../src/utils/Lyrics/Fork/MandarinEzaLine.ts", import.meta.url), "utf8");
  assert.match(config, /jieba-wasm\/pkg\/web\/jieba_rs_wasm_bg\.wasm/u);
  assert.match(config, /loader: \{ "\.wasm": "binary" \}/u);
  assert.match(line, /module_or_path: bytes/u);
});
