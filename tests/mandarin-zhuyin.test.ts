import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolveZhuyinSpans, scanZhuyinRuns, zhuyinInventory } from "../src/utils/Lyrics/Fork/MandarinZhuyin.ts";
import { formatPinyin } from "../src/utils/Lyrics/Fork/MandarinPinyinFormat.ts";
import { convertMandarinSyllableToVnAid } from "../src/utils/Lyrics/Fork/MandarinVnAid.ts";
import { ensureMandarinSegmenter, mandarinEzaReadings } from "../src/utils/Lyrics/Fork/MandarinEzaLine.ts";
import { romanizeMandarin, romanizeMandarinVn, romanizeZhuyinText } from "../src/utils/Lyrics/Fork/Romanization.ts";
import {
  resolveCjkDocumentBranch,
  resolveCjkLineRoute,
  scriptBranchForLine,
} from "../src/utils/Lyrics/Fork/TextDetection.ts";
import { mandarinTimedChunkPlan } from "../src/utils/Lyrics/Processing/ChineseTimedChunks.ts";
import { buildTimedGenericPlan } from "../src/utils/Lyrics/Processing/GenericReadingProcessor.ts";
import { partitionCjkReadingRuns, romanizeChineseDominantCjkText } from "../src/utils/Lyrics/Processing/CjkLanguageRouting.ts";
import { buildProcessingContextKey, type ProcessingContext } from "../src/utils/Lyrics/ProcessingContext.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/mandarin-zhuyin-parity.json", import.meta.url), "utf8")) as {
  revision: string;
  inventory: { zhuyin: string; pinyin: string }[];
  parserCases: { source: string; spans: { start: number; end: number; pinyin: string }[] }[];
  products: {
    continuous: string;
    continuousPlain: string;
    continuousVn: string;
    qingtian: { source: string; plain: string; vn: string }[];
  };
};

const flatten = (source: string) => resolveZhuyinSpans(source)
  .flatMap((run) => run.syllables)
  .map((syllable) => ({ start: syllable.start, end: syllable.end, pinyin: syllable.pinyin }));

test("the desktop inventory is the Android inventory, in order", () => {
  assert.equal(fixture.revision, "zhuyin-2026-11-18.2");
  assert.deepEqual(zhuyinInventory(), fixture.inventory);
  assert.equal(fixture.inventory.length, 410);
});

test("every Java parser case resolves to the same source spans and numbered Pinyin", () => {
  assert.equal(fixture.parserCases.length, 2886);
  let differences = 0;
  for (const row of fixture.parserCases) {
    if (JSON.stringify(flatten(row.source)) !== JSON.stringify(row.spans)) differences += 1;
  }
  assert.equal(differences, 0);
});

test("continuous and spaced authored Bopomofo runs resolve greedily, longest syllable first", () => {
  assert.deepEqual(flatten(fixture.products.continuous), [
    { start: 0, end: 2, pinyin: "mu1" }, { start: 2, end: 4, pinyin: "mu1" },
    { start: 4, end: 6, pinyin: "xi1" }, { start: 6, end: 8, pinyin: "lu1" },
    { start: 8, end: 10, pinyin: "xi1" }, { start: 10, end: 12, pinyin: "li1" },
  ]);
  assert.deepEqual(flatten("ㄇㄨ ㄇㄨㄒㄧ ㄌㄨㄒㄧㄌㄧ"), [
    { start: 0, end: 2, pinyin: "mu1" }, { start: 3, end: 5, pinyin: "mu1" },
    { start: 5, end: 7, pinyin: "xi1" }, { start: 8, end: 10, pinyin: "lu1" },
    { start: 10, end: 12, pinyin: "xi1" }, { start: 12, end: 14, pinyin: "li1" },
  ]);
});

test("the actual 晴天 hook rows preserve Han 一 as an authored medial", () => {
  const [first, second] = fixture.products.qingtian;
  assert.deepEqual(flatten(first.source), [
    { start: 0, end: 3, pinyin: "rui1" }, { start: 4, end: 6, pinyin: "sou1" },
    { start: 7, end: 9, pinyin: "sou1" }, { start: 10, end: 12, pinyin: "xi1" },
    { start: 13, end: 15, pinyin: "dou1" }, { start: 16, end: 18, pinyin: "xi1" },
    { start: 19, end: 21, pinyin: "la1" },
  ]);
  assert.deepEqual(flatten(second.source), [
    { start: 0, end: 2, pinyin: "sou1" }, { start: 3, end: 5, pinyin: "la1" },
    { start: 6, end: 8, pinyin: "xi1" }, { start: 9, end: 11, pinyin: "xi1" },
    { start: 12, end: 14, pinyin: "xi1" }, { start: 15, end: 17, pinyin: "xi1" },
    { start: 18, end: 20, pinyin: "la1" }, { start: 21, end: 23, pinyin: "xi1" },
    { start: 24, end: 26, pinyin: "la1" }, { start: 27, end: 29, pinyin: "sou1" },
  ]);
  assert.equal(romanizeMandarin(first.source), first.plain);
  assert.equal(romanizeMandarinVn(first.source), first.vn);
  assert.equal(romanizeMandarin(second.source), second.plain);
  assert.equal(romanizeMandarinVn(second.source), second.vn);
  assert.equal(romanizeMandarinVn(first.source), "ruêi sou sou shi tou shi la");
  assert.equal(romanizeMandarinVn(second.source), "sou la shi shi shi shi la shi la sou");
});

test("tones, neutral dots, apical vowels and contractions follow the standard inventory", () => {
  for (const [source, expected] of [
    ["ㄇㄨ", "mu1"], ["ㄇㄨˉ", "mu1"], ["ㄇㄨˊ", "mu2"], ["ㄇㄨˇ", "mu3"], ["ㄇㄨˋ", "mu4"],
    ["˙ㄇㄨ", "mu5"], ["ㄇㄨ˙", "mu5"], ["ㄇㄚ˙ㄇㄚ", "ma1 ma5"],
    ["ㄓ", "zhi1"], ["ㄔˊ", "chi2"], ["ㄕˇ", "shi3"], ["ㄖˋ", "ri4"], ["ㄗ", "zi1"], ["ㄘ", "ci1"], ["ㄙ", "si1"],
    ["ㄧ", "yi1"], ["ㄨ", "wu1"], ["ㄩ", "yu1"], ["ㄋㄩˇ", "nü3"], ["ㄐㄩˊ", "ju2"], ["ㄩㄝˋ", "yue4"],
    ["ㄌㄧㄡˊ", "liu2"], ["ㄍㄨㄟˋ", "gui4"], ["ㄉㄨㄣˋ", "dun4"], ["ㄒㄩㄥ", "xiong1"],
    ["ㄏㄨㄚㄦ", "hua1 er1"], ["ㄧㄛ", "yo1"],
  ] as const) {
    assert.equal(flatten(source).map((span) => span.pinyin).join(" "), expected, source);
  }
});

test("invalid, unsupported and mixed runs stay literal without leaking a Han 一 reading", () => {
  for (const source of ["ㄪㄚ", "ㄅㄩ", "ㄇㄨㄚ", "ㄒㄨ", "ㄇㄨˊˋ", "ㄇㄨㄇ"]) {
    assert.deepEqual(resolveZhuyinSpans(source), [], source);
    assert.equal(romanizeMandarin(source), source, source);
    assert.equal(romanizeMandarinVn(source), source, source);
  }
  // Han 一 is a medial only after a licensed Bopomofo initial. Ordinary Han and apical initials
  // keep their existing Han reading.
  assert.deepEqual(flatten("ㄒ一"), [{ start: 0, end: 2, pinyin: "xi1" }]);
  assert.deepEqual(flatten("一ㄒ一"), [{ start: 1, end: 3, pinyin: "xi1" }]);
  assert.equal(romanizeMandarin("一ㄒ一"), "yī xī");
  assert.deepEqual(flatten("ㄓ一"), [{ start: 0, end: 1, pinyin: "zhi1" }]);
  assert.equal(romanizeMandarin("ㄓ一"), "zhī yī");
  assert.deepEqual(resolveZhuyinSpans("ㄅ一ㄚ"), []);
  assert.equal(romanizeMandarin("ㄅ一ㄚ"), "ㄅ一ㄚ");
  assert.equal(romanizeMandarinVn("ㄅ一ㄚ"), "ㄅ一ㄚ");
  assert.equal(romanizeMandarin("ㄈ一"), "ㄈ yī");
  assert.equal(romanizeMandarin("ㄒㄨ一"), "ㄒㄨ yī");
  assert.equal(romanizeMandarin("きみ"), "きみ");
  assert.deepEqual(scanZhuyinRuns("ㄅ一ㄚ").map((run) => run.valid), [false]);
});

test("authored syllables never join a Han sandhi run", async () => {
  assert.deepEqual(mandarinEzaReadings("ㄋㄧˇㄏㄠˇ").map((item) => [item.citation, item.surface]),
    [["ni3", "ni3"], ["hao3", "hao3"]]);
  await ensureMandarinSegmenter();
  const mixed = mandarinEzaReadings("你好ㄇㄨˇ");
  assert.deepEqual(mixed.filter((item) => item.isZh).map((item) => [item.origin, item.surface]),
    [["你", "ni2"], ["好", "hao3"], ["ㄇㄨˇ", "mu3"]]);
  assert.equal(romanizeMandarinVn("你好ㄇㄨˇ"), "ní hảo mủ");
});

test("mode projections use the same authored reading", () => {
  assert.equal(romanizeMandarin("ㄇㄨㄒㄧ"), "mū xī");
  assert.equal(romanizeMandarinVn("ㄇㄨㄒㄧ"), "mu shi");
  assert.equal(romanizeZhuyinText("ㄇㄨㄒㄧ", "pinyin"), "mū xī");
  assert.equal(romanizeZhuyinText("ㄇㄨㄒㄧ", "pinyin-vn"), "mu shi");
  assert.equal(romanizeMandarin("我ㄇㄨˇ你"), "wǒ mǔ nǐ");
  assert.equal(romanizeMandarinVn("ㄇㄨㄒㄧ", true), "mu shi");
  assert.equal(romanizeMandarinVn("ㄇㄨㄒㄧ", false), "mu shi");
});

test("Zhuyin-only and mixed lines take the Chinese route, kana stays Japanese", () => {
  assert.equal(resolveCjkDocumentBranch("ㄇㄨ\nㄒㄧ", "jpn"), "Chinese");
  assert.equal(resolveCjkLineRoute("ㄇㄨ", { presentScripts: ["Chinese"], primaryLanguage: "jpn" }), "Chinese");
  assert.equal(resolveCjkLineRoute("ㄙㄡ ㄌㄚ ㄒ一", { presentScripts: ["Chinese"], primaryLanguage: "cmn" }), "Chinese");
  assert.equal(resolveCjkLineRoute("きみ", { presentScripts: ["Japanese"], primaryLanguage: "jpn" }), "Japanese");
  assert.equal(resolveCjkLineRoute("我ㄇㄨˇ你", { presentScripts: ["Chinese"], primaryLanguage: "cmn", cjkDominantBranch: "Chinese" }), "Chinese");
  assert.deepEqual(scriptBranchForLine("ㄇㄨ", { presentScripts: ["Chinese"], primaryLanguage: "cmn" }), ["Chinese"]);
  assert.equal(resolveCjkDocumentBranch("hello world", "eng"), undefined);
  assert.deepEqual(scriptBranchForLine("hello world", { presentScripts: [], primaryLanguage: "eng" }), []);
});

test("Chinese-dominant splitting keeps the Han 一 medial inside the Zhuyin run", async () => {
  assert.deepEqual(partitionCjkReadingRuns("我ㄒ一"), [
    { kind: "Han", text: "我" },
    { kind: "Zhuyin", text: "ㄒ一" },
  ]);
  const routed = await romanizeChineseDominantCjkText("我ㄒ一", {
    romanizeHan: () => "ngo5",
    romanizeKana: () => undefined,
    romanizeZhuyin: (run) => romanizeZhuyinText(run, "pinyin-vn", true),
  });
  assert.equal(routed, "ngo5 shi");
});

test("timed chunks keep one display owner when a provider cuts an authored syllable", () => {
  const line = "ㄖㄨㄟ ㄙㄡ ㄙㄡ ㄒ一 ㄉㄡ ㄒ一 ㄌㄚ";
  const ranges = [
    { startCp: 0, endCp: 3 }, { startCp: 4, endCp: 18 }, { startCp: 19, endCp: 21 },
  ];
  const plan = mandarinTimedChunkPlan(line, ["ㄖㄨㄟ", "ㄙㄡ ㄙㄡ ㄒ一 ㄉㄡ ㄒ一", "ㄌㄚ"], "pinyin-vn", true, ranges);
  assert.deepEqual(plan?.chunks, ["ruêi", "sou sou shi tou shi", "la"]);
  assert.equal(plan?.chunks.some((chunk) => chunk === null), false);
  assert.deepEqual(plan?.logicalGroupIds, ["zhuyin-0", "zhuyin-1", "zhuyin-2"]);

  const split = mandarinTimedChunkPlan("ㄒ一ㄉㄡ", ["ㄒ", "一", "ㄉㄡ"], "pinyin-vn", true, [
    { startCp: 0, endCp: 1 }, { startCp: 1, endCp: 2 }, { startCp: 2, endCp: 4 },
  ]);
  assert.deepEqual(split?.chunks, ["shi", null, "tou"]);
  assert.deepEqual(split?.logicalGroupIds, ["zhuyin-0", "zhuyin-0", "zhuyin-2"]);

  const built = buildTimedGenericPlan({
    StartTime: 0,
    EndTime: 1000,
    Syllables: [
      { Text: "ㄒ", StartTime: 0, EndTime: 300 },
      { Text: "一", StartTime: 300, EndTime: 600 },
      { Text: "ㄉㄡ", StartTime: 600, EndTime: 1000 },
    ],
  }, "shi tou", "Chinese", {
    finalizedChunks: { chunks: ["shi", "", "tou"], logicalGroupIds: ["zhuyin-0", "zhuyin-0", "zhuyin-2"] },
  });
  assert.equal(built?.joinedDisplayText, "shi tou");
  assert.deepEqual(built?.timedReadingUnits.map((unit) => unit.text), ["shi", "", " tou"]);
  assert.deepEqual(built?.timedReadingUnits.map((unit) => unit.spanId), ["0", "1", "2"]);
  assert.equal(built?.readingUnits[1]?.logicalGroupId, "zhuyin-0");
});

test("authored canonical ê keeps its tone mark without changing Han output", () => {
  assert.equal(formatPinyin("ê1"), "ê̄");
  assert.equal(formatPinyin("ê2"), "ế");
  assert.equal(formatPinyin("ê3"), "ê̌");
  assert.equal(formatPinyin("ê4"), "ề");
  assert.equal(formatPinyin("ê5"), "ê");
  assert.equal(convertMandarinSyllableToVnAid("ê2"), "ế");
  assert.equal(romanizeMandarin("ㄝˊ"), "ế");
  assert.equal(romanizeMandarin("你好"), "nǐ hǎo");
});

test("the processing revision and cache identity move with the resolver", () => {
  const source = readFileSync(new URL("../src/utils/Lyrics/ProcessLyrics.ts", import.meta.url), "utf8");
  assert.match(source, /export const LYRICS_PROCESSING_VERSION = 44;/u);
  const context: ProcessingContext = {
    translationEnabled: false,
    translationTargetLang: "en",
    chineseTranslitMode: "pinyin",
    chineseTones: true,
    joinMandarinWords: false,
    chineseReadingPlacement: "lineBelow",
    chineseCharacterForm: "original",
    koreanDisplayMode: "rrStandard",
    cyrillicRomanizationMode: "Russian",
    cyrillicKeepSigns: false,
    japaneseReadingMode: "romaji",
  };
  assert.equal(JSON.parse(buildProcessingContextKey(context)).mandarinZhuyinRevision, "zhuyin-2026-11-18.2");
});
