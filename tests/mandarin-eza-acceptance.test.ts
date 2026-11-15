import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pinyin as packagePinyin } from "pinyin-pro";
import { before, test } from "node:test";
import { ensureMandarinSegmenter, mandarinEzaReadings, mandarinLayer1Line } from "../src/utils/Lyrics/Fork/MandarinEzaLine.ts";
import { ezaSurfaceReadings, type MandarinEzaReadingLine, type MandarinEzaSyllable } from "../src/utils/Lyrics/Fork/MandarinEzaSandhi.ts";
import { realizeSurfaceTones } from "../src/utils/Lyrics/Fork/MandarinEzaTones.ts";
import { convertMandarinSyllableToVnAid } from "../src/utils/Lyrics/Fork/MandarinVnAid.ts";

before(async () => { assert.equal(await ensureMandarinSegmenter(), true); });

/**
 * The owner's acceptance table, revision 3 (`docs/eza-mandarin-revision-3.md` in cjk-labs).
 * Rows are checked at the layer 2–4 boundary with the owner-confirmed reading supplied, because the installed
 * g2pM/phrase pack still disagrees on some neutral readings (漂亮, 认识, 头发, 早上, 小姐, 想想, 知道).
 * Reader accuracy is measured separately; those rows are recorded reading gaps, not per-word patches.
 */
type Row = readonly [source: string, reading: string, tones: string, eza: string];
const ROWS: readonly Row[] = [
  ["你好", "ni3 hao3", "2 3", "ní hảo"],
  ["妈妈", "ma1 ma5", "1 6", "ma mà"],
  ["我很好", "wo3 hen3 hao3", "3 2 3", "wỏhấnhảo"],
  ["他的", "ta1 de5", "1 6", "thatờ"],
  ["你很美", "ni3 hen3 mei3", "3 2 3", "nỉhấnmểi"],
  ["先生", "xian1 sheng5", "1 6", "shien shầng"],
  ["知道", "zhi1 dao5", "1 6", "zhư tào"],
  ["哥哥", "ge1 ge5", "1 6", "kưa kừa"],
  ["我也想你", "wo3 ye3 xiang3 ni3", "2 3 2 3", "wóyẻshiángnỉ"],
  ["爷爷", "ye2 ye5", "2 7", "yé yẻ"],
  ["朋友", "peng2 you5", "2 7", "pấng yỏu"],
  ["头发", "tou2 fa5", "2 7", "thóu fả"],
  ["婆婆", "po2 po5", "2 7", "puó puỏ"],
  ["我也想你好", "wo3 ye3 xiang3 ni3 hao3", "2 3 2 2 3", "wóyẻshiángní hảo"],
  ["来了", "lai2 le5", "2 0", "láilơ"],
  ["觉得", "jue2 de5", "2 0", "zyué tơ"],
  ["别的", "bie2 de5", "2 0", "bié tơ"],
  ["什么", "shen2 me5", "2 0", "shấn mơ"],
  ["老李买酒", "lao3 li3 mai3 jiu3", "2 3 2 3", "láo lỉmái ziỏu"],
  ["你买好酒", "ni3 mai3 hao3 jiu3", "2 3 2 3", "nímải háoziỏu"],
  ["姐姐", "jie3 jie5", "3 0", "ziẻ zie"],
  ["我的", "wo3 de5", "3 0", "wỏtơ"],
  ["奶奶", "nai3 nai5", "3 0", "nải nai"],
  ["喜欢", "xi3 huan5", "3 0", "shỉ huan"],
  ["早上", "zao3 shang5", "3 0", "zảo shang"],
  ["椅子", "yi3 zi5", "3 0", "yỉ zư"],
  ["耳朵", "er3 duo5", "3 0", "ẻr tuo"],
  ["老总好看", "lao3 zong3 hao3 kan4", "2 2 3 4", "láo zónghảo khàn"],
  ["爸爸", "ba4 ba5", "4 6", "ba bà"],
  ["弟弟", "di4 di5", "4 6", "ti tì"],
  ["谢谢", "xie4 xie5", "4 6", "shie shiè"],
  ["漂亮", "piao4 liang5", "4 6", "piao liàng"],
  ["意思", "yi4 si5", "4 6", "yi sừ"],
  ["认识", "ren4 shi5", "4 6", "rân shừ"],
  ["这个", "zhe4 ge5", "4 6", "zhưa kừa"],
  ["是的", "shi4 de5", "4 6", "shưtờ"],
  ["去吧", "qu4 ba5", "4 6", "chyubà"],
  ["展览馆", "zhan3 lan3 guan3", "2 2 3", "zhán lán kuản"],
  ["这样", "zhe4 yang4", "4 4", "zhưa yàng"],
  ["去看", "qu4 kan4", "4 4", "chyukhàn"],
  ["在这", "zai4 zhe4", "4 4", "zaizhừa"],
  ["小老虎", "xiao3 lao3 hu3", "3 2 3", "shiảo láo hủ"],
  ["纸老虎", "zhi3 lao3 hu3", "3 2 3", "zhử láo hủ"],
  ["汽车", "qi4 che1", "4 1", "chì chưa"],
  ["大家", "da4 jia1", "4 1", "tà zia"],
  ["面包", "mian4 bao1", "4 1", "mièn bao"],
  ["唱歌", "chang4 ge1", "4 1", "chàng kưa"],
  ["认真", "ren4 zhen1", "4 1", "rần zhân"],
  ["想想", "xiang3 xiang5", "2 0", "shiáng shiang"],
  ["特别", "te4 bie2", "4 2", "thừa bié"],
  ["问题", "wen4 ti2", "4 2", "wuần thí"],
  ["电脑", "dian4 nao3", "4 3", "tièn nảo"],
  ["跳舞", "tiao4 wu3", "4 3", "thiào wủ"],
  ["小姐", "xiao3 jie3", "2 3", "shiáo ziẻ"],
  ["地方", "di4 fang1", "4 1", "tì fang"],
];

/** Replace a line's layer-1 syllables with an owner-confirmed reading; `5` keeps the character's real tone. */
function withReading(line: MandarinEzaReadingLine, reading: string): MandarinEzaReadingLine {
  const syllables = reading.trim().split(/\s+/u);
  let at = 0;
  return { ...line, tokens: line.tokens.map((token) => {
    if (token.kind !== "han") return token;
    const own = syllables.slice(at, at + Array.from(token.text).length);
    at += own.length;
    return { ...token, syllables: own.map((item, index): MandarinEzaSyllable => {
      const digit = Number(item.at(-1)) as 1 | 2 | 3 | 4 | 5, letters = item.slice(0, -1);
      const original = token.syllables[index];
      const real = digit === 5 && original?.status === "available" && original.letters === letters ? original.tone : digit;
      return { status: "available", letters, tone: real, neutral: digit === 5,
        ...(digit === 5 && original?.status === "available" && original.alwaysNeutral ? { alwaysNeutral: true as const } : {}) };
    }) };
  }) };
}

test("every acceptance row spells and sets tones as the owner accepted", () => {
  const failures: string[] = [];
  for (const [source, reading, tones, expected] of ROWS) {
    const line = withReading(mandarinLayer1Line(source), reading);
    const actualTones = ezaSurfaceReadings(line).flatMap((own) => own?.map((syllable) => syllable.slice(-1)) ?? ["?"]).join(" ");
    const realized = realizeSurfaceTones(ezaSurfaceReadings(line));
    const actual = line.tokens.flatMap((token, index) => {
      const own = realized[index];
      return own ? [own.map((syllable) => convertMandarinSyllableToVnAid(syllable)).join(" ")] : [];
    }).join("");
    if (actualTones !== tones || actual !== expected) failures.push(`${source}: tones ${actualTones} (want ${tones}), eza ${actual} (want ${expected})`);
  }
  assert.deepEqual(failures, [], "The acceptance table is the owner's revision-3 decision.");
});

type Case = Readonly<{ source: string; pinyin: string; eza: string }>;
const fixture = JSON.parse(readFileSync(new URL("./fixtures/eza-rev3-parity.json", import.meta.url), "utf8")) as Readonly<{
  schema: string; policy: string; cases: readonly Case[];
}>;

test("the revision 3 parity corpus matches the desktop layers", () => {
  assert.equal(fixture.schema, "cjk-labs.eza-rev3-parity.v1");
  assert.equal(fixture.policy, "eza-2026-11-15.3");
  assert.ok(fixture.cases.length >= 110);
  const differences: unknown[] = [];
  for (const item of fixture.cases) {
    const items = mandarinEzaReadings(item.source);
    assert.equal(items.map((reading) => reading.origin).join(""), item.source);
    let eza = "", previousHan = false;
    for (const reading of items) {
      if (reading.isZh) {
        assert.match(reading.citation, /^[a-zü]+[1-5]$/u);
        assert.match(reading.surface, /^[a-zü]+[0-7]$/u);
        eza += `${previousHan ? " " : ""}${convertMandarinSyllableToVnAid(reading.surface)}`;
        previousHan = true;
      } else { eza += reading.origin; previousHan = false; }
    }
    const packageItems = packagePinyin(item.source, { type: "all", toneSandhi: false });
    let offset = 0, pinyin = "", previous = false;
    for (const reading of packageItems) {
      const span = Array.from(reading.origin).length;
      const han = /^\p{Script=Han}+$/u.test(reading.origin);
      pinyin += `${han && previous ? " " : ""}${reading.result ?? reading.origin}`;
      previous = han;
      offset += span;
    }
    assert.ok(offset > 0);
    if (pinyin !== item.pinyin || eza !== item.eza) differences.push({ source: item.source, expected: { pinyin: item.pinyin, eza: item.eza }, actual: { pinyin, eza } });
  }
  assert.deepEqual(differences, [], "The desktop layers must reproduce the accepted corpus.");
});
