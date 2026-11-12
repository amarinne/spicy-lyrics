import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, test } from "node:test";
import { ensureMandarinSegmenter } from "../src/utils/Lyrics/Fork/MandarinEzaLine.ts";
import { romanizeMandarin, romanizeMandarinVn } from "../src/utils/Lyrics/Fork/Romanization.ts";
import { buildTimedGenericPlan } from "../src/utils/Lyrics/Processing/GenericReadingProcessor.ts";
import { mandarinTimedChunks } from "../src/utils/Lyrics/Processing/ChineseTimedChunks.ts";

// A syllable-timed Chinese line: every timed syllable shows the line-level reading, and the line is never glued.
before(async () => {
  assert.equal(await ensureMandarinSegmenter(), true);
});

type Mode = "pinyin" | "pinyin-vn";
const display = (line: string, mode: Mode) => (mode === "pinyin-vn" ? romanizeMandarinVn(line) : romanizeMandarin(line));
/** A timed line whose syllables carry the given readings, as the per-syllable pass would leave them. */
const timed = (texts: readonly string[], readings: readonly (string | undefined)[]) => ({
  Syllables: texts.map((Text, index) => ({ Text, StartTime: index, EndTime: index + 1, ...(readings[index] !== undefined ? { RomanizedText: readings[index] } : {}) })),
});
/** The chunks the line-level helper gives each syllable, and the plan text built from them. */
function viaLineReading(line: string, texts: readonly string[], mode: Mode) {
  const chunks = mandarinTimedChunks(line, texts, mode, true);
  assert.ok(chunks, "the line maps to its syllables");
  const plan = buildTimedGenericPlan(timed(texts, chunks), display(line, mode), "Chinese", {});
  return { chunks, text: plan?.joinedDisplayText };
}

test("a Latin word split across two timed syllables stays spaced and equals the line display", () => {
  const line = "从前那个少年 Miya";
  const texts = ["从", "前", "那", "个", "少", "年", " Mi", "ya"];
  const { chunks, text } = viaLineReading(line, texts, "pinyin-vn");
  assert.equal(text, "tsóng chién na kừa shào nién Miya");
  assert.equal(text, display(line, "pinyin-vn"));
  // The chunks are the line's own spelling (na, shào), not the context-free readings (nà, shảo).
  assert.deepEqual(chunks, ["tsóng", "chién", "na", "kừa", "shào", "nién", undefined, undefined], "Latin syllables keep their own text");
});

test("a timed line with sandhi, a neutral and a tone 4 pair gives per-syllable chunks equal to the line display", () => {
  const cases: readonly (readonly [string, readonly string[]])[] = [
    ["你好吗", ["你", "好", "吗"]],
    ["代价", ["代", "价"]],
    ["换种生活 让自己变得快乐", ["换", "种", "生", "活", " 让", "自", "己", "变", "得", "快", "乐"]],
    ["我想你 Miya", ["我", "想", "你", " Mi", "ya"]],
    ["从前那个少年", ["从前", "那个", "少年"]],
  ];
  for (const [line, texts] of cases) {
    for (const mode of ["pinyin-vn", "pinyin"] as const) {
      const { chunks, text } = viaLineReading(line, texts, mode);
      assert.equal(text, display(line, mode), `${mode}: ${line}`);
      assert.equal(chunks.length, texts.length);
    }
  }
  // The listed examples, spelled out.
  assert.deepEqual(mandarinTimedChunks("你好吗", ["你", "好", "吗"], "pinyin-vn", true), ["ní", "hảo", "ma"]);
  assert.deepEqual(mandarinTimedChunks("代价", ["代", "价"], "pinyin-vn", true), ["tai", "zià"]);
  assert.deepEqual(mandarinTimedChunks("快乐", ["快", "乐"], "pinyin-vn", true), ["khuai", "lừa"]);
  assert.deepEqual(mandarinTimedChunks("从前那个少年", ["从前", "那个", "少年"], "pinyin-vn", true), ["tsóng chién", "na kừa", "shào nién"]);
});

test("Standard Pinyin keeps citation tones in the chunks, and stays spaced", () => {
  const line = "你好吗 Miya";
  const texts = ["你", "好", "吗", " Mi", "ya"];
  assert.deepEqual(mandarinTimedChunks(line, texts, "pinyin", true), ["nǐ", "hǎo", "ma", undefined, undefined]);
  assert.deepEqual(mandarinTimedChunks(line, texts, "pinyin", false), ["ni", "hao", "ma", undefined, undefined]);
  const { text } = viaLineReading(line, texts, "pinyin");
  assert.equal(text, "nǐ hǎo ma Miya");
});

test("the alignment fallback keeps its spaces when a chunk cannot be located in the line display", () => {
  const line = "从前那个少年 Miya";
  const displayText = romanizeMandarinVn(line);
  // The old per-syllable readings (citation tones nà, shảo) are not in the sandhi line display, and the Latin word is split,
  // so the chunk count differs and alignment fails. This used to glue every syllable.
  const stale = ["tsóng", "chién", "nà", "kừa", "shảo", "nién", "Mi", "ya"];
  const plan = buildTimedGenericPlan(timed(["从", "前", "那", "个", "少", "年", " Mi", "ya"], stale), displayText, "Chinese", {});
  assert.ok(plan);
  assert.ok(/\s/u.test(plan.joinedDisplayText), "not glued");
  assert.equal(plan.joinedDisplayText, "tsóng chién nà kừa shảo nién Mi ya");
  // Provider word continuations still take no inferred space.
  const joined = buildTimedGenericPlan(
    { Syllables: ["从", "前", "那", "个", "少", "年", " Mi", "ya"].map((Text, index) => ({ Text, StartTime: index, EndTime: index + 1, RomanizedText: stale[index], IsPartOfWord: index === 7 })) },
    displayText, "Chinese", {});
  assert.equal(joined?.joinedDisplayText, "tsóng chién nà kừa shảo nién Miya");
  // Standard Pinyin in the same situation.
  const pinyinStale = ["cóng", "qián", "nà", "gè", "shǎo", "nián", "Mi", "ya"];
  const pinyinPlan = buildTimedGenericPlan(timed(["从", "前", "那", "个", "少", "年", " Mi", "ya"], pinyinStale), romanizeMandarin(line), "Chinese", {});
  assert.ok(pinyinPlan && /\s/u.test(pinyinPlan.joinedDisplayText), "Standard Pinyin is not glued");
});

test("lines the helper cannot map keep their own readings", () => {
  assert.equal(mandarinTimedChunks("你好", ["你"], "pinyin-vn", true), undefined, "syllables do not cover the line");
  assert.equal(mandarinTimedChunks("你好", ["你", "好"], "jyutping-vn", true), undefined, "Cantonese is not handled here");
  assert.equal(mandarinTimedChunks("你好の", ["你", "好", "の"], "pinyin-vn", true), undefined, "kana lines use the Japanese route");
  assert.deepEqual(mandarinTimedChunks("你 好!", ["你", " 好", "!"], "pinyin-vn", true), ["nỉ", "hảo", undefined], "a space ends the sandhi domain; non-Han syllables keep their own text");
});

test("the timed-line pass takes its Mandarin chunks from the line-level reading", () => {
  // ProcessLyrics needs the Spotify runtime, so this guards the wiring at the source level.
  const source = readFileSync(new URL("../src/utils/Lyrics/ProcessLyrics.ts", import.meta.url), "utf8");
  assert.match(source, /mandarinTimedChunks\(effectiveLineText, syllables\.map\(/u);
  assert.match(source, /syllable\.RomanizedText = lineChunks\[index\]/u);
  const processor = readFileSync(new URL("../src/utils/Lyrics/Processing/GenericReadingProcessor.ts", import.meta.url), "utf8");
  assert.match(processor, /align\(chunks, display\) \?\? withTimedBoundaries\(chunks, sourceTexts, wordContinuations\)/u);
});
