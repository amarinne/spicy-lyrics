import assert from "node:assert/strict";
import { before, test } from "node:test";
import {
  ezaSurfaceReadings,
  type MandarinEzaReadingLine,
  type MandarinEzaSyllable,
  type MandarinEzaToken,
} from "../src/utils/Lyrics/Fork/MandarinEzaSandhi.ts";
import { realizeNeutralTones, realizeSurfaceTones } from "../src/utils/Lyrics/Fork/MandarinEzaTones.ts";
import { ensureMandarinSegmenter } from "../src/utils/Lyrics/Fork/MandarinEzaLine.ts";
import { convertMandarinSyllableToVnAid } from "../src/utils/Lyrics/Fork/MandarinVnAid.ts";

before(async () => { assert.equal(await ensureMandarinSegmenter(), true); });

// Ported from cjk-labs tests/eza-sandhi.test.ts (policy eza-2026-11-15.3, Mandarin revision 3).
// The pure modules are driven with hand-built tokens, so these tests do not depend on the pack.

/** A token spec: the surface, then one layer-1 syllable per character. `null` is a punctuation gap. */
type Spec = readonly [surface: string, ...syllables: string[]] | null;
/** Optional segmentation evidence for a token, keyed by its surface. */
type Extra = Readonly<{ searchPieces?: readonly string[]; pos?: string }>;

/**
 * A layer-1 syllable: `ni3` full tone, `ma5` neutral with no known real tone, `ma5:1` neutral with real tone 1,
 * `ma5:3!` neutral that the word only ever reads neutral, and `?` unavailable.
 */
const SYLLABLE = /^([a-zü]+)([1-5])(?::([1-5]))?(!)?$/u;
function syllableOf(spec: string): MandarinEzaSyllable {
  if (spec === "?") return { status: "unavailable", reason: "Test gap." };
  const match = SYLLABLE.exec(spec);
  assert.ok(match, `Unreadable fixture syllable: ${spec}`);
  const letters = match[1]!, digit = Number(match[2]), neutral = digit === 5;
  const tone = neutral ? Number(match[3] ?? 5) : digit;
  const alternatives = neutral && tone !== 5 ? [`${letters}${tone}`] : undefined;
  return { status: "available", letters, tone: tone as 1 | 2 | 3 | 4 | 5, neutral,
    ...(alternatives ? { alternatives } : {}), ...(match[4] ? { alwaysNeutral: true as const } : {}) };
}
function fixture(extras: Readonly<Record<string, Extra>>, ...specs: readonly Spec[]): MandarinEzaReadingLine {
  let start = 0;
  const tokens: MandarinEzaToken[] = [];
  for (const spec of specs) {
    const surface = spec ? spec[0] : "。", size = Array.from(surface).length;
    const extra = spec ? extras[surface] : undefined;
    tokens.push({ text: surface, range: { start, end: start + size }, kind: spec ? "han" : "punctuation",
      tag: extra?.pos ?? "x", subwords: extra?.searchPieces ?? [],
      syllables: spec ? (spec.slice(1) as string[]).map(syllableOf) : [] });
    start += size;
  }
  return { text: tokens.map((token) => token.text).join(""), tokens };
}
/** The surface tone digits of every Han syllable after layer 2, or `?` for a gap. */
function digits(extra: Readonly<Record<string, Extra>>, ...specs: readonly Spec[]): string {
  return ezaSurfaceReadings(fixture(extra, ...specs)).flatMap((own) => (own ? own.map((syllable) => syllable.slice(-1)) : ["?"])).join(" ");
}
/** The eza式 spelling of every Han token after layers 2–4. */
function say(extra: Readonly<Record<string, Extra>>, ...specs: readonly Spec[]): string[] {
  const line = fixture(extra, ...specs);
  const realized = realizeSurfaceTones(ezaSurfaceReadings(line));
  return realized.flatMap((own) => (own ? [own.map((syllable) => convertMandarinSyllableToVnAid(syllable)).join(" ")] : []));
}
const spelled = (canonical: string, tones = true) => {
  const parts = canonical.trim().split(/\s+/u);
  const realized = realizeNeutralTones(parts.map((syllable) => Number(syllable.at(-1))));
  return parts.map((syllable, index) => convertMandarinSyllableToVnAid(`${syllable.slice(0, -1)}${realized[index]!}`, tones)).join(" ");
};

test("third-tone sandhi inside one token: nǐ hǎo is ní hảo", () => {
  assert.equal(digits({}, ["你好", "ni3", "hao3"]), "2 3");
  assert.deepEqual(say({}, ["你好", "ni3", "hao3"]), ["ní hảo"]);
  assert.equal(spelled("ni2 hao3", false), "ni hao");
});

test("一 and 不 take their spoken tones, and the patterns the rules set neutral", () => {
  assert.equal(digits({}, ["一定", "yi1", "ding4"]), "2 4");
  assert.equal(digits({}, ["一起", "yi1", "qi3"]), "4 3");
  assert.equal(digits({}, ["不对", "bu4", "dui4"]), "2 4");
  assert.equal(digits({}, ["看一看", "kan4", "yi1", "kan4"]), "4 6 4");
  assert.equal(digits({ 看不懂: { pos: "v" } }, ["看不懂", "kan4", "bu4", "dong3"]), "4 6 3");
  assert.equal(digits({}, ["对不对", "dui4", "bu4", "dui4"]), "4 6 4");
  // 一 between a verb and a measure word is neutral, and the whole token keeps its shape.
  assert.equal(digits({ 去一趟: { pos: "v", searchPieces: ["一趟"] } }, ["去一趟", "qu4", "yi1", "tang4"]), "4 6 4");
  // Segmenters split 不对 and 一个, so a lone 不 or 一 joins the token after it.
  assert.equal(digits({}, ["不", "bu4"], ["对", "dui4"]), "2 4");
  assert.equal(digits({}, ["一", "yi1"], ["个", "ge5:4"]), "2 0");
  assert.equal(digits({}, ["看", "kan4"], ["一", "yi1"], ["看", "kan4"]), "4 6 4");
  assert.equal(digits({}, ["不", "bu4"], ["好", "hao3"]), "4 3");
  // A following N counts by its real tone: 一个 is yí, 不是 is bú.
  assert.deepEqual(say({}, ["一个", "yi1", "ge5:4"]), ["yí kưa"]);
  assert.deepEqual(say({}, ["不是", "bu4", "shi4"]), ["bú shừ"]);
});

test("一 keeps tone 1 as an ordinal, in a digit series and after a numeral", () => {
  assert.equal(digits({}, ["第一", "di4", "yi1"]), "4 1");
  assert.equal(digits({}, ["十一", "shi2", "yi1"]), "2 1");
  assert.equal(digits({}, ["十一月", "shi2", "yi1", "yue4"]), "2 1 4");
  assert.equal(digits({}, ["一二三四", "yi1", "er4", "san1", "si4"]), "1 4 1 4");
  assert.deepEqual(say({}, ["第一", "di4", "yi1"]), ["tì yi"]);
});

test("adjacent third-tone tokens form one run, split into pairs from the left", () => {
  assert.equal(digits({}, ["我", "wo3"], ["很好", "hen3", "hao3"]), "3 2 3");
  assert.equal(digits({}, ["我", "wo3"], ["很", "hen3"], ["好", "hao3"]), "3 2 3");
  assert.equal(digits({}, ["展览", "zhan3", "lan3"], ["馆", "guan3"]), "2 2 3");
  assert.equal(digits({}, ["你", "ni3"], ["好", "hao3"]), "2 3");
  assert.equal(digits({}, ["我很好", "wo3", "hen3", "hao3"]), "3 2 3");
});

test("a run of four or more third tones is 2 3 units, and an odd run ends with a 3-syllable unit", () => {
  assert.equal(digits({}, ["老总", "lao3", "zong3"], ["很", "hen3"], ["好", "hao3"]), "2 3 2 3");
  assert.equal(digits({}, ["老总", "lao3", "zong3"], ["很好", "hen3", "hao3"]), "2 3 2 3");
  assert.equal(digits({}, ["请你", "qing3", "ni3"], ["指导", "zhi3", "dao3"]), "2 3 2 3");
  assert.equal(digits({}, ["你好", "ni3", "hao3"], ["很好", "hen3", "hao3"], ["老总", "lao3", "zong3"]), "2 3 2 3 2 3");
  // (请你)(指导我): the trailing three-syllable unit is verb + pronoun object, so 2 2 3.
  assert.equal(digits({}, ["请你", "qing3", "ni3"], ["指导", "zhi3", "dao3"], ["我", "wo3"]), "2 3 2 2 3");
  assert.equal(digits({}, ["岂有此理", "qi3", "you3", "ci3", "li3"]), "2 3 2 3");
  // 我 + 也 + 想 + 你好, with 想 tagged as the verb that governs 你好.
  assert.equal(digits({ 想: { pos: "v" } }, ["我", "wo3"], ["也", "ye3"], ["想", "xiang3"], ["你好", "ni3", "hao3"]), "2 3 2 2 3");
});

test("a three-syllable unit is read by its structure", () => {
  // word + syllable: 展览 + 馆.
  assert.equal(digits({ 展览馆: { searchPieces: ["展览"] } }, ["展览馆", "zhan3", "lan3", "guan3"]), "2 2 3");
  // verb + object across a word boundary: 老总 + 好看.
  assert.equal(digits({}, ["老总", "lao3", "zong3"], ["好看", "hao3", "kan4"]), "2 2 3 4");
  // syllable + word: 小 + 老虎; 纸 + 老虎.
  assert.equal(digits({ 小老虎: { searchPieces: ["老虎"] } }, ["小老虎", "xiao3", "lao3", "hu3"]), "3 2 3");
  assert.equal(digits({ 纸老虎: { searchPieces: ["老虎"] } }, ["纸老虎", "zhi3", "lao3", "hu3"]), "3 2 3");
  // A pronoun first: 我 + 很好.
  assert.equal(digits({}, ["我很好", "wo3", "hen3", "hao3"]), "3 2 3");
  // A repeated character: 好好好.
  assert.equal(digits({}, ["好好好", "hao3", "hao3", "hao3"]), "2 2 3");
  // No subword and no verb tag gives the syllable + word shape.
  assert.equal(digits({ 纸老虎: { pos: "n" } }, ["纸老虎", "zhi3", "lao3", "hu3"]), "3 2 3");
});

test("tone 3 before a neutral tone 3 rises only when the word can give it a full tone", () => {
  assert.equal(digits({}, ["想想", "xiang3", "xiang5:3"]), "2 0");
  assert.deepEqual(say({}, ["想想", "xiang3", "xiang5:3"]), ["shiáng shiang"]);
  assert.equal(digits({}, ["等等", "deng3", "deng5:3"]), "2 0");
  // The word only reads these neutral, so the first syllable stays third.
  assert.equal(digits({}, ["姐姐", "jie3", "jie5:3!"]), "3 0");
  assert.equal(digits({}, ["椅子", "yi3", "zi5:3!"]), "3 0");
  assert.equal(digits({}, ["耳朵", "er3", "duo5:3!"]), "3 0");
  // A neutral with no same-letter full tone (我的) does not lower the third tone.
  assert.equal(digits({}, ["我的", "wo3", "de5"]), "3 0");
  // 小姐 can give 姐 a full third tone, so the first syllable rises and 姐 keeps its hook.
  assert.equal(digits({}, ["小姐", "xiao3", "jie3"]), "2 3");
  assert.deepEqual(say({}, ["小姐", "xiao3", "jie3"]), ["shiáo ziẻ"]);
});

test("a neutral takes its pitch class from the syllable before it", () => {
  // After tone 1 the neutral is grave.
  assert.equal(digits({}, ["妈妈", "ma1", "ma5:1"]), "1 6");
  assert.equal(digits({}, ["他的", "ta1", "de5:1"]), "1 6");
  assert.equal(digits({}, ["哥哥", "ge1", "ge5:1"]), "1 6");
  assert.equal(digits({}, ["衣服", "yi1", "fu5:2"]), "1 6");
  // After tone 2 a full vowel takes the hook; a reduced or high vowel stays unmarked.
  assert.equal(digits({}, ["爷爷", "ye2", "ye5:2"]), "2 7");
  assert.equal(digits({}, ["朋友", "peng2", "you5:3"]), "2 7");
  assert.equal(digits({}, ["头发", "tou2", "fa5:4"]), "2 7");
  assert.equal(digits({}, ["婆婆", "po2", "po5:2"]), "2 7");
  assert.equal(digits({}, ["来了", "lai2", "le5"]), "2 0");
  assert.equal(digits({}, ["觉得", "jue2", "de5:2"]), "2 0");
  assert.equal(digits({}, ["什么", "shen2", "me5:2"]), "2 0");
  assert.equal(digits({}, ["孩子", "hai2", "zi5:3"]), "2 0");
  // After tone 3 the neutral is unmarked.
  assert.equal(digits({}, ["我的", "wo3", "de5"]), "3 0");
  assert.equal(digits({}, ["奶奶", "nai3", "nai5:3!"]), "3 0");
  assert.equal(digits({}, ["喜欢", "xi3", "huan5:1"]), "3 0");
  assert.equal(digits({}, ["早上", "zao3", "shang5:4"]), "3 0");
  // After a sandhi-lowered third tone the neutral stays unmarked: 想想 is not a full tone 2 rise.
  assert.equal(digits({}, ["想想", "xiang3", "xiang5:3"]), "2 0");
  // After tone 4 the neutral is grave.
  assert.equal(digits({}, ["爸爸", "ba4", "ba5:4"]), "4 6");
  assert.equal(digits({}, ["妹妹", "mei4", "mei5:4"]), "4 6");
  // After another neutral there is no mark.
  assert.equal(digits({}, ["爸爸的", "ba4", "ba5:4"], ["的", "de5"]), "4 6 0");
});

test("the full pipeline spells the accepted neutral marks", () => {
  assert.deepEqual(say({}, ["妈妈", "ma1", "ma5:1"]), ["ma mà"]);
  assert.deepEqual(say({}, ["他的", "ta1", "de5:1"]), ["tha tờ"]);
  assert.deepEqual(say({}, ["爷爷", "ye2", "ye5:2"]), ["yé yẻ"]);
  assert.deepEqual(say({}, ["朋友", "peng2", "you5:3"]), ["pấng yỏu"]);
  assert.deepEqual(say({}, ["头发", "tou2", "fa5:4"]), ["thóu fả"]);
  assert.deepEqual(say({}, ["来了", "lai2", "le5"]), ["lái lơ"]);
  assert.deepEqual(say({}, ["什么", "shen2", "me5:2"]), ["shấn mơ"]);
  assert.deepEqual(say({}, ["姐姐", "jie3", "jie5:3!"]), ["ziẻ zie"]);
  assert.deepEqual(say({}, ["爸爸", "ba4", "ba5:4"]), ["ba bà"]);
  assert.deepEqual(say({}, ["妹妹", "mei4", "mei5:4"]), ["mêi mềi"]);
  assert.deepEqual(say({}, ["爸爸", "ba4", "ba5:4"], ["的", "de5"]), ["ba bà", "tơ"]);
});

test("layer 3 writes a tone 4 before tone 4 or N flat, across words too", () => {
  assert.equal(spelled("dai4 jia4"), "tai zià");
  assert.equal(spelled("zhe4 yang4"), "zhưa yàng");
  assert.equal(spelled("jian4 mian4"), "zien mièn");
  assert.equal(spelled("mei4 mei0"), "mêi mềi");
  assert.equal(spelled("shi4 de0"), "shư tờ");
  // The rule needs the line's adjacency, so a layer-3 line pass flattens across tokens.
  const line = fixture({}, ["去", "qu4"], ["看", "kan4"]);
  assert.deepEqual(realizeSurfaceTones(ezaSurfaceReadings(line)), [["qu1"], ["kan4"]]);
  assert.deepEqual(say({}, ["去", "qu4"], ["看", "kan4"]), ["chyu", "khàn"]);
  // Tones 1, 2 and 3 keep the grave on the tone 4 before them.
  assert.equal(spelled("qi4 che1"), "chì chưa");
  assert.equal(spelled("te4 bie2"), "thừa bié");
  assert.equal(spelled("dian4 nao3"), "tièn nảo");
  assert.equal(spelled("di4 fang1"), "tì fang");
  // A neutral after a flattened tone 4 takes the grave (是的, 去吧).
  assert.deepEqual(say({}, ["是的", "shi4", "de5"]), ["shư tờ"]);
  assert.deepEqual(say({}, ["去吧", "qu4", "ba5"]), ["chyu bà"]);
});

test("a gap ends a run: punctuation and unavailable readings never lower a neighbour", () => {
  assert.equal(digits({}, ["请你", "qing3", "ni3"], null, ["指导", "zhi3", "dao3"]), "2 3 ? 2 3");
  assert.equal(digits({}, ["我", "wo3"], ["?", "?"], ["好", "hao3"]), "3 ? 3");
  assert.deepEqual(say({}, ["请你", "qing3", "ni3"], null, ["指导", "zhi3", "dao3"]), ["chíng nỉ", "zhứ tảo"]);
});

test("layer 2 rejects a line that is not in revision-3 input form", () => {
  assert.throws(() => ezaSurfaceReadings(fixture({}, ["一", "yi4"])), /一 must be yi1/u);
  assert.throws(() => ezaSurfaceReadings(fixture({}, ["不", "bu2"])), /不 must be bu4/u);
  const neutral = (syllable: MandarinEzaSyllable) => {
    const line = fixture({}, ["的", "de5"]);
    const token = line.tokens[0]!;
    return () => ezaSurfaceReadings({ ...line, tokens: [{ ...token, syllables: [syllable] }] });
  };
  assert.throws(neutral({ status: "available", letters: "de", tone: 5, neutral: true, alternatives: ["de2"] }), /must carry its real tone/u);
  // 的, 了, 们 and 吗 have no same-letter full tone, so their neutral 5 is legal.
  assert.doesNotThrow(neutral({ status: "available", letters: "de", tone: 5, neutral: true }));
  assert.doesNotThrow(neutral({ status: "available", letters: "de", tone: 2, neutral: true }));
});
