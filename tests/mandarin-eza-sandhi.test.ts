import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buYiSandhi,
  mandarinEzaSurfaceSyllables,
  realizeNeutralTones,
  runFormulaLowered,
  type MandarinEzaToken,
} from "../src/utils/Lyrics/Fork/MandarinEzaSandhi.ts";
import { mandarinEzaReadings } from "../src/utils/Lyrics/Fork/MandarinEzaLine.ts";
import { convertMandarinSyllableToVnAid } from "../src/utils/Lyrics/Fork/MandarinVnAid.ts";

// Ported from cjk-labs tests/eza-sandhi.test.ts (policy eza-2026-11-12.2, decisions M1a, M1b, M4a).
// The pure module is driven with hand-built tokens, so these tests do not depend on the segmenter.

/** A token spec: the surface, then one citation syllable per character. `null` is a punctuation gap. */
type Spec = readonly [surface: string, ...syllables: string[]] | null;
type Extra = { searchPieces?: readonly string[]; pos?: string; neutral?: readonly number[] };

function build(extras: Readonly<Record<string, Extra>>, specs: readonly Spec[]) {
  const syllables: (string | undefined)[] = [];
  const tokens: MandarinEzaToken[] = [];
  const han: { start: number; size: number }[] = [];
  for (const spec of specs) {
    const start = syllables.length;
    if (!spec) {
      syllables.push(undefined);
      continue;
    }
    const [surface, ...own] = spec;
    const extra = extras[surface];
    tokens.push({
      surface,
      start,
      ...(extra?.searchPieces ? { searchPieces: extra.searchPieces } : {}),
      ...(extra?.pos ? { pos: extra.pos } : {}),
      ...(extra?.neutral ? { dictionaryNeutral: extra.neutral } : {}),
    });
    syllables.push(...own);
    han.push({ start, size: own.length });
  }
  return { syllables, tokens, han };
}

/** The eza式 spelling of every Han token after sandhi. */
function say(...specs: Spec[]): string[] {
  const { syllables, tokens, han } = build({}, specs);
  const out = mandarinEzaSurfaceSyllables(syllables, tokens);
  return han.map(({ start, size }) => out.slice(start, start + size).map((syllable) => convertMandarinSyllableToVnAid(syllable!)).join(" "));
}

/** The surface tone digits of every Han syllable, in order. */
function digits(extras: Readonly<Record<string, Extra>>, ...specs: Spec[]): string {
  const { syllables, tokens } = build(extras, specs);
  return mandarinEzaSurfaceSyllables(syllables, tokens).filter(Boolean).map((syllable) => syllable!.slice(-1)).join(" ");
}

const mono = (surface: string, syllable: string): Spec => [surface, syllable];

test("third-tone sandhi inside one token: nǐ hǎo is ní hảo", () => {
  assert.deepEqual(say(["你好", "ni3", "hao3"]), ["ní hảo"]);
  const { syllables, tokens } = build({}, [["你好", "ni3", "hao3"]]);
  assert.deepEqual(mandarinEzaSurfaceSyllables(syllables, tokens).map((syllable) => convertMandarinSyllableToVnAid(syllable!, false)), ["ni", "hao"]);
});

test("一 and 不 take their spoken tones, and the neutral tones the rules set", () => {
  assert.deepEqual(say(["一定", "yi1", "ding4"]), ["yí tìng"]);
  assert.deepEqual(say(["一起", "yi1", "qi3"]), ["yì chỉ"]);
  assert.deepEqual(say(["不对", "bu4", "dui4"]), ["bú tuềi"]);
  assert.deepEqual(say(["看一看", "kan4", "yi1", "kan4"]), ["khan yì khàn"]);
  assert.deepEqual(say(["看不懂", "kan4", "bu4", "dong3"]), ["khan bù tỏng"]);
  // Segmenters split 不对 and 一个, so a lone 不 or 一 joins the token after it; 一 between identical verbs joins both.
  assert.deepEqual(say(["不", "bu4"], ["对", "dui4"]), ["bú", "tuềi"]);
  assert.deepEqual(say(["一", "yi1"], ["个", "ge4"]), ["yí", "kừa"]);
  assert.deepEqual(say(["看", "kan4"], ["一", "yi1"], ["看", "kan4"]), ["khan", "yì", "khàn"]);
  assert.deepEqual(say(["不", "bu4"], ["好", "hao3"]), ["bù", "hảo"]);
  // Ordinal and numeral series keep 一 high.
  assert.deepEqual(buYiSandhi("第一", [4, 1]), [4, 1]);
  assert.deepEqual(buYiSandhi("统一", [3, 1]), [3, 1]);
});

test("adjacent third-tone tokens are grouped by the tokens themselves", () => {
  assert.deepEqual(say(["我", "wo3"], ["很好", "hen3", "hao3"]), ["wỏ", "hấn hảo"]);
  assert.deepEqual(say(["我", "wo3"], ["很", "hen3"], ["好", "hao3"]), ["wỏ", "hấn", "hảo"]);
  assert.deepEqual(say(["展览", "zhan3", "lan3"], ["馆", "guan3"]), ["zhán lán", "kuản"]);
  assert.deepEqual(say(["你", "ni3"], ["好", "hao3"]), ["ní", "hảo"]);
});

test("a run of four or more third tones splits into pairs across tokens", () => {
  assert.deepEqual(say(["老总", "lao3", "zong3"], ["很", "hen3"], ["好", "hao3"]), ["láo zỏng", "hấn", "hảo"]);
  assert.deepEqual(say(["老总", "lao3", "zong3"], ["很好", "hen3", "hao3"]), ["láo zỏng", "hấn hảo"]);
  assert.deepEqual(say(["请你", "qing3", "ni3"], ["指导", "zhi3", "dao3"]), ["chíng nỉ", "zhứ tảo"]);
  assert.deepEqual(say(["你好", "ni3", "hao3"], ["很好", "hen3", "hao3"], ["老总", "lao3", "zong3"]), ["ní hảo", "hấn hảo", "láo zỏng"]);
  assert.deepEqual(say(["请你", "qing3", "ni3"], ["指导", "zhi3", "dao3"], ["我", "wo3"]), ["chíng nỉ", "zhứ táo", "wỏ"]);
  // A tone other than 3 ends the run, so the shorter runs keep their own rules.
  assert.deepEqual(say(["很", "hen3"], ["好", "hao3"], ["吗", "ma0"], ["你好", "ni3", "hao3"]), ["hấn", "hảo", "ma", "ní hảo"]);
  assert.deepEqual(say(["岂有此理", "qi3", "you3", "ci3", "li3"]), ["chí yỏu tsứ lỉ"]);
});

test("a domain ends at punctuation, a missing reading, or a line break", () => {
  assert.deepEqual(say(["不", "bu4"], null, ["对", "dui4"]), ["bù", "tuềi"]);
  const { syllables, tokens } = build({}, [["不", "bu4"], ["对", "dui4"]]);
  syllables[1] = undefined;
  assert.deepEqual(mandarinEzaSurfaceSyllables(syllables, tokens), ["bu4", undefined]);
  // 我想你 / 你好: the line break keeps the two runs apart (3 2 3 and 2 3, not one run of five).
  assert.equal(digits({}, mono("我", "wo3"), mono("想", "xiang3"), mono("你", "ni3"), null, ["你好", "ni3", "hao3"]), "3 2 3 2 3");
  assert.equal(digits({}, mono("我", "wo3"), mono("想", "xiang3"), mono("你", "ni3"), ["你好", "ni3", "hao3"]), "2 3 3 2 3");
  // A single three-syllable token with no subwords falls back to the run formula: 3 2 3.
  assert.deepEqual(say(["纸老虎", "zhi3", "lao3", "hu3"]), ["zhử láo hủ"]);
});

test("the end-to-end line keeps line breaks and punctuation as domain boundaries (fallback segmenter)", () => {
  const spell = (text: string) => mandarinEzaReadings(text).filter((item) => item.isZh).map((item) => convertMandarinSyllableToVnAid(item.surface)).join(" ");
  assert.equal(spell("我想你\n你好"), "wỏ shiáng nỉ ní hảo");
  assert.equal(spell("我想你，你好"), "wỏ shiáng nỉ ní hảo");
  assert.equal(spell("他\n的"), "tha tơ");
});

test("a neutral tone takes its pitch from the syllable before it, across tokens too", () => {
  assert.deepEqual(say(["他", "ta1"], ["的", "de0"]), ["tha", "tờ"]);
  assert.deepEqual(say(["是", "shi4"], ["的", "de0"]), ["shư", "tờ"]);
  assert.deepEqual(say(["我", "wo3"], ["的", "de0"]), ["wỏ", "tơ"]);
  assert.equal(say(["谁", "shei2"], ["的", "de0"])[1], "tơ");
  assert.deepEqual(say(["妹妹", "mei4", "mei0"]), ["mêi mềi"]);
  assert.deepEqual(say(["他", "ta1"], null, ["的", "de0"]), ["tha", "tơ"]);
  // Sandhi comes first: 你好 is ní hǎo, so the neutral after it follows the surface tone 3.
  assert.deepEqual(say(["你好", "ni3", "hao3"], ["吗", "ma0"]), ["ní hảo", "ma"]);
});

test("realizeNeutralTones: only the first neutral of a run falls, and a tone 4 before it is written high", () => {
  assert.deepEqual(realizeNeutralTones([1, 0]), [1, 6]);
  assert.deepEqual(realizeNeutralTones([4, 5]), [1, 6]);
  assert.deepEqual(realizeNeutralTones([2, 0]), [2, 0]);
  assert.deepEqual(realizeNeutralTones([3, 0]), [3, 0]);
  assert.deepEqual(realizeNeutralTones([4, 0, 0]), [1, 6, 0]);
  assert.deepEqual(realizeNeutralTones([0]), [0]);
});

test("the run formula: pairs from the left, an odd run ends 1+2", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(runFormulaLowered), [[], [0], [1], [0, 2], [0, 3], [0, 2, 4], [0, 2, 5]]);
});

test("runs of single-character third tones follow the owner's patterns", () => {
  const run = (n: number) => digits({}, ...Array.from({ length: n }, (_, index) => mono("好我你他想也的"[index], "hao3")));
  assert.deepEqual([2, 3, 4, 5, 6].map(run), ["2 3", "3 2 3", "2 3 2 3", "2 3 3 2 3", "2 3 2 3 2 3"]);
});

test("words are feet, strays attach to a foot, and two feet never merge", () => {
  assert.equal(digits({}, ["我", "wo3"], ["也", "ye3"], ["想", "xiang3"], ["你好", "ni3", "hao3"]), "2 3 3 2 3");
  assert.equal(digits({}, ["我也", "wo3", "ye3"], ["想", "xiang3"], ["你好", "ni3", "hao3"]), "2 3 3 2 3");
  assert.equal(digits({}, ["老总", "lao3", "zong3"], ["好看", "hao3", "kan4"]), "2 3 3 4");
  assert.equal(digits({}, ["老总", "lao3", "zong3"], mono("很", "hen3"), mono("好", "hao3")), "2 3 2 3");
  assert.equal(digits({}, ["你好", "ni3", "hao3"], ["你好", "ni3", "hao3"], ["你好", "ni3", "hao3"]), "2 3 2 3 2 3");
  assert.equal(digits({}, ["指导", "zhi3", "dao3"], mono("我", "wo3")), "2 2 3");
  assert.equal(digits({}, mono("我", "wo3"), ["好看", "hao3", "kan4"]), "2 3 4");
});

test("a three-syllable word groups by its subwords, and falls back to the run formula", () => {
  assert.equal(digits({ 展览馆: { searchPieces: ["展览"] } }, ["展览馆", "zhan3", "lan3", "guan3"]), "2 2 3");
  assert.equal(digits({ 纸老虎: { searchPieces: ["老虎"] } }, ["纸老虎", "zhi3", "lao3", "hu3"]), "3 2 3");
  assert.equal(digits({}, ["好想你", "hao3", "xiang3", "ni3"]), "3 2 3");
});

test("a character repeated three or more times keeps its citation tones; once is normal", () => {
  assert.equal(digits({}, mono("好", "hao3"), mono("好", "hao3"), mono("好", "hao3")), "3 3 3");
  assert.equal(digits({}, ["好好", "hao3", "hao3"]), "2 3");
  assert.equal(digits({}, ["好好好", "hao3", "hao3", "hao3"]), "3 3 3");
  assert.equal(digits({}, mono("哈", "ha1"), mono("哈", "ha1"), mono("哈", "ha1")), "1 1 1");
  // A raw repeat ends a run, so its neighbours do not lower against it.
  assert.equal(digits({}, mono("我", "wo3"), mono("好", "hao3"), mono("好", "hao3"), mono("好", "hao3")), "3 3 3 3");
});

test("verb reduplication and dictionary flags set the neutral tone before sandhi", () => {
  assert.equal(digits({ 试试: { pos: "v" } }, ["试试", "shi4", "shi4"]), "1 6", "试试: tone 4, then a neutral that falls");
  assert.equal(digits({ 试试: { pos: "vn" } }, ["试试", "shi4", "shi4"]), "1 6", "a tag starting with v is a verb");
  assert.equal(digits({}, ["试试", "shi4", "shi4"]), "1 4", "no verb tag, no neutral; a tone 4 before a tone 4 in one token is tone 1");
  assert.equal(digits({ 人人: { pos: "n" } }, ["人人", "ren2", "ren2"]), "2 2", "other reduplication is not neutral");
  assert.equal(digits({ 朋友: { neutral: [1] } }, ["朋友", "peng2", "you3"]), "2 0", "the dictionary's neutral after tone 2 stays level");
  assert.equal(digits({ 哥哥: { neutral: [1] } }, ["哥哥", "ge1", "ge1"]), "1 6");
  // The neutral flag breaks a third-tone run.
  assert.equal(digits({ 老鼠们: { neutral: [2] } }, ["老鼠们", "lao3", "shu3", "men2"]), "2 3 0");
});

test("an infix 不 between two identical characters is neutral whatever the tokens are, and wins over 不 before tone 4", () => {
  // The segmenter may return one token (对不对) or split it (对 / 不对); the result is the same.
  assert.deepEqual(say(["对不对", "dui4", "bu4", "dui4"]), ["tuêi bù tuềi"]);
  assert.deepEqual(say(["对", "dui4"], ["不对", "bu4", "dui4"]), ["tuêi", "bù tuềi"]);
  assert.deepEqual(say(["要", "yao4"], ["不要", "bu4", "yao4"]), ["yao", "bù yào"]);
  assert.deepEqual(say(["能", "neng2"], ["不能", "bu4", "neng2"]), ["nấng", "bu nấng"]);
  assert.deepEqual(say(["好不好", "hao3", "bu4", "hao3"]), ["hảo bu hảo"]);
  // Different characters keep the 不-before-tone-4 rule.
  assert.deepEqual(say(["我", "wo3"], ["不", "bu4"], ["是", "shi4"]), ["wỏ", "bú", "shừ"]);
  // A raw repeat is untouched.
  assert.equal(digits({}, mono("对", "dui4"), mono("不", "bu4"), mono("对", "dui4"), mono("对", "dui4"), mono("对", "dui4")), "4 4 4 4 4");
});

test("a tone 4 before a tone 4 inside one token is flat tone 1; feet and single-character tokens do not affect each other", () => {
  assert.deepEqual(say(["代价", "dai4", "jia4"]), ["tai zià"]);
  assert.deepEqual(say(["再见", "zai4", "jian4"]), ["zai zièn"]);
  assert.deepEqual(say(["爱过", "ai4", "guo4"]), ["ai kuò"]);
  assert.equal(digits({}, ["再见面", "zai4", "jian4", "mian4"]), "1 1 4", "4 4 4 in one token is 1 1 4");
  assert.equal(digits({}, mono("这", "zhe4"), mono("样", "yang4")), "4 4", "single-character tokens stay 4 4");
  assert.equal(digits({}, ["现在", "xian4", "zai4"], ["是", "shi4"]), "1 4 4", "a foot does not affect the next foot");
  assert.equal(digits({}, mono("再", "zai4"), ["见面", "jian4", "mian4"]), "4 1 4");
  // A raw repeat is untouched; a neutral between two 4s is not a 4.
  assert.equal(digits({}, mono("去", "qu4"), mono("去", "qu4"), mono("去", "qu4")), "4 4 4");
  assert.equal(digits({}, ["再来", "zai4", "lai0"]), "1 6");
});

// Ported from cjk-labs tests/eza-sandhi.test.ts (cb41f37): function morphemes, infix 不 limits and Han numerals.
function sayWith(extras: Readonly<Record<string, Extra>>, ...specs: Spec[]): string[] {
  const { syllables, tokens, han } = build(extras, specs);
  const out = mandarinEzaSurfaceSyllables(syllables, tokens);
  return han.map(({ start, size }) => out.slice(start, start + size).map((syllable) => convertMandarinSyllableToVnAid(syllable!)).join(" "));
}

test("particles tagged by jieba and the plural 们 are neutral with the particle's reading", () => {
  // 地 and 得 read as de, not dì or dé: 慢慢地走, 走得太快.
  assert.deepEqual(sayWith({ 地: { pos: "uv" } }, ["慢慢", "man4", "man4"], ["地", "di4"], ["走", "zou3"]), ["man man", "tờ", "zỏu"]);
  assert.deepEqual(sayWith({ 得: { pos: "ud" } }, ["走", "zou3"], ["得", "de2"], ["太快", "tai4", "kuai4"]), ["zỏu", "tơ", "thai khuài"]);
  // 着 reads zhe, so 看着 no longer reads zhù: 4 then a falling neutral.
  assert.deepEqual(sayWith({ 着: { pos: "uz" } }, ["看", "kan4"], ["着", "zhu4"]), ["khan", "zhờ"]);
  assert.deepEqual(sayWith({ 了: { pos: "ul" }, 吧: { pos: "y" } }, ["走", "zou3"], ["了", "liao3"], ["吧", "ba5"]), ["zỏu", "lơ", "ba"]);
  assert.deepEqual(sayWith({ 过: { pos: "ug" } }, ["去", "qu4"], ["过", "guo4"]), ["chyu", "kuò"]);
  // The tag must match: an untagged 地 keeps the provider's reading, and a tag on a longer token does not apply.
  assert.deepEqual(say(["地", "di4"]), ["tì"]);
  assert.deepEqual(sayWith({ 地方: { pos: "uv" } }, ["地方", "di4", "fang1"]), ["tì fang"]);
  // 们 after a Han character is neutral men; at the start of a domain it keeps the provider's reading.
  assert.deepEqual(say(["朋友", "peng2", "you3"], ["们", "men2"]), ["pấng yỏu", "mân"]);
  assert.deepEqual(say(["们", "men2"]), ["mấn"]);
});

test("an infix 不 skips particles and repeated words; 一 after a numeral keeps tone 1", () => {
  // 得不得了 keeps 不; 不是不是 is a repeated word, so each 不 takes 不 + tone 4.
  assert.equal(digits({ 得: { pos: "ud" } }, mono("开", "kai1"), mono("得", "de2"), ["不得了", "bu4", "de2", "liao3"]), "1 6 4 2 3");
  assert.equal(digits({}, ["不是", "bu4", "shi4"], ["不是", "bu4", "shi4"]), "2 4 2 4");
  // Han numerals: 十一月, 二十一 and 一二三四 keep 一 at tone 1.
  assert.equal(digits({}, mono("十", "shi2"), mono("一", "yi1"), mono("月", "yue4")), "2 1 4");
  assert.equal(digits({}, ["一二三四", "yi1", "er4", "san1", "si4"]), "1 4 1 4");
  assert.equal(digits({}, mono("二", "er4"), mono("十", "shi2"), mono("一", "yi1")), "4 2 1");
  assert.deepEqual(buYiSandhi("十一月", [2, 1, 4]), [2, 1, 4]);
  assert.deepEqual(buYiSandhi("一九一", [1, 3, 1]), [1, 3, 1]);
});

test("end to end with jieba: particles, plural and the lyric examples", async () => {
  const { ensureMandarinSegmenter, setMandarinNeutralWords } = await import("../src/utils/Lyrics/Fork/MandarinEzaLine.ts");
  const { romanizeMandarinVn } = await import("../src/utils/Lyrics/Fork/Romanization.ts");
  assert.equal(await ensureMandarinSegmenter(), true);
  setMandarinNeutralWords(undefined);
  assert.equal(romanizeMandarinVn("慢慢地走"), "man man tờ zỏu");
  assert.equal(romanizeMandarinVn("开心得不得了"), "khai shin tờ bù tứa liảo");
  assert.equal(romanizeMandarinVn("说着话"), "shuo zhờ huà");
  assert.equal(romanizeMandarinVn("你说呢"), "nỉ shuo nờ");
  assert.equal(romanizeMandarinVn("走吧"), "zỏu ba");
  assert.equal(romanizeMandarinVn("十一月"), "shứ yi yuè");
  assert.equal(romanizeMandarinVn("二十一"), "èr shứ yi");
  assert.equal(romanizeMandarinVn("一二三四"), "yi èr san sừ");
  assert.equal(romanizeMandarinVn("不是不是"), "bú shừ bú shừ");
  setMandarinNeutralWords(new Map([["朋友|peng you", [1]]]));
  try {
    assert.equal(romanizeMandarinVn("朋友们"), "pấng you mân");
  } finally {
    setMandarinNeutralWords(undefined);
  }
});

// Owner findings from two checked songs (2026-11-13; cjk-labs a6c337b, 56f8621).
test("快乐 keeps its dictionary tone: no word list overrides it", () => {
  assert.equal(digits({}, ["快乐", "kuai4", "le4"]), "1 4", "快 is flat by the 4+4 rule; 乐 keeps its full tone");
  assert.deepEqual(say(["快乐", "kuai4", "le4"]), ["khuai lừa"]);
  assert.deepEqual(say(["快樂", "kuai4", "le4"]), ["khuai lừa"]);
  assert.deepEqual(say(["生日快乐", "sheng1", "ri4", "kuai4", "le4"]), ["shâng rư khuai lừa"]);
});

test("a three-character token with 不 in the middle is neutral, except a conjunction or adverb", () => {
  assert.deepEqual(say(["看不懂", "kan4", "bu4", "dong3"]), ["khan bù tỏng"]);
  assert.deepEqual(say(["差不多", "cha4", "bu4", "duo1"]), ["cha bù tuo"]);
  assert.deepEqual(say(["对不起", "dui4", "bu4", "qi3"]), ["tuêi bù chỉ"]);
  // 只不过 is tagged as an adverb or conjunction, so only its last two characters take the 不 rule: bú guò.
  assert.deepEqual(sayWith({ 只不过: { pos: "c" } }, ["只不过", "zhi1", "bu4", "guo4"]), ["zhư bú kuò"]);
  assert.deepEqual(sayWith({ 只不过: { pos: "d" } }, ["只不过", "zhi1", "bu4", "guo4"]), ["zhư bú kuò"]);
  assert.deepEqual(sayWith({ 只不过: { pos: "n" } }, ["只不过", "zhi1", "bu4", "guo4"]), ["zhư bù kuò"], "any other tag keeps the neutral 不");
});

test("妳 reads as 你 in Standard Pinyin and in eza式, and the source surface is kept", async () => {
  const { ensureMandarinSegmenter, mandarinEzaReadings } = await import("../src/utils/Lyrics/Fork/MandarinEzaLine.ts");
  const { romanizeMandarin, romanizeMandarinVn, buildMandarinWordLayout } = await import("../src/utils/Lyrics/Fork/Romanization.ts");
  const { buildChineseAttachedReadings } = await import("../src/utils/Lyrics/Processing/ChineseReadingSegments.ts");
  assert.equal(await ensureMandarinSegmenter(), true);
  assert.equal(romanizeMandarin("妳好"), "nǐ hǎo");
  assert.equal(romanizeMandarin("妳的美"), "nǐ de měi");
  assert.equal(romanizeMandarinVn("妳眼帶笑意"), "ní yiẻn tài shiao yì");
  assert.deepEqual(mandarinEzaReadings("妳好").map((item) => item.origin), ["妳", "好"], "the source surface is kept");
  assert.deepEqual(buildMandarinWordLayout("妳好").tokens.map((token) => token.text), ["妳", "好"]);
  const spans = [0, 1].map((i) => ({ spanId: String(i), canonicalRange: { startCp: i, endCp: i + 1 } }));
  assert.deepEqual(buildChineseAttachedReadings("妳好", "pinyin", true, spans).map((r) => r.reading), ["nǐ", "hǎo"]);
  assert.deepEqual(buildChineseAttachedReadings("妳好", "pinyin-vn", true, spans).map((r) => r.reading), ["ní", "hảo"]);
});
