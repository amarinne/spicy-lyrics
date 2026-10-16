import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DefaultCanonicalLineBuilder } from "../src/utils/Lyrics/Processing/Canonical.ts";
import { annotateKoreanLine } from "../src/utils/Lyrics/Processing/Korean/KoreanAnnotationProcessor.ts";
import { DefaultRenderPlanBuilder, validateRenderPlan } from "../src/utils/Lyrics/Processing/RenderPlan.ts";
import { buildTimedGenericPlan } from "../src/utils/Lyrics/Processing/GenericReadingProcessor.ts";
import { buildMandarinWordLayout, romanizeCyrillic } from "../src/utils/Lyrics/Fork/Romanization.ts";
import type { ParsedLine } from "../src/utils/Lyrics/Processing/Model.ts";

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL(
  "./fixtures/lyrics-reading/v1/camouflage-provider.json", import.meta.url
)), "utf8"));

function parsed(raw: any): ParsedLine {
  return { id: raw.id, displayText: raw.expected.canonicalText, paragraphProvenance: "unavailable",
    spans: raw.spans.map((s: any[], i: number) => ({ id: `${raw.id}-s${i}`, rawText: s[0], cleanText: s[0],
      providerPartOfWord: s[1], startMs: s[2], endMs: s[3] })) };
}

test("render plan gives every provider span one unique timing owner", () => {
  const raw = fixture.lines.find((line: any) => line.id === "camouflage-29");
  const line = parsed(raw);
  const canonical = new DefaultCanonicalLineBuilder().build(line);
  const plan = new DefaultRenderPlanBuilder().build(line, canonical, [annotateKoreanLine(canonical, "vnPronunciation")]);
  assert.equal(plan.joinedDisplayText, "jujo opssi da, Probably delete it");
  assert.equal(plan.timedReadingUnits.length, line.spans.length);
  assert.equal(new Set(plan.timedReadingUnits.map((unit) => unit.spanId)).size, line.spans.length);
  assert.equal(validateRenderPlan(plan).valid, true);
});

test("timed Mandarin plan groups syllables by segmented words", () => {
  const group = {
    StartTime: 0,
    EndTime: 4,
    Syllables: [
      { Text: "音", RomanizedText: "yīn", StartTime: 0, EndTime: 1, IsPartOfWord: true },
      { Text: "乐", RomanizedText: "yuè", StartTime: 1, EndTime: 2, IsPartOfWord: true },
      { Text: "银", RomanizedText: "yín", StartTime: 2, EndTime: 3, IsPartOfWord: true },
      { Text: "行", RomanizedText: "háng", StartTime: 3, EndTime: 4, IsPartOfWord: true },
    ],
  };
  const plan = buildTimedGenericPlan(group, "yīn yuè yín háng", "Chinese", {
    mandarinWordLayout: buildMandarinWordLayout("音乐银行"),
  });
  assert.equal(plan?.joinedDisplayText, "yīnyuè yínháng");
  assert.deepEqual(plan?.timedReadingUnits.map((unit) => unit.text), ["yīn", "yuè", " yín", "háng"]);
});

test("Cyrillic word-timed lines keep word spacing in the reading plan", () => {
  // "Я помнил всё и всё забыл" split into words. The per-syllable pass
  // romanizes every item, one-letter words included.
  const group = {
    StartTime: 0,
    EndTime: 4,
    Syllables: [
      { Text: "Я", RomanizedText: romanizeCyrillic("Я"), StartTime: 0, EndTime: 0.5, IsPartOfWord: false },
      { Text: "помнил", RomanizedText: romanizeCyrillic("помнил"), StartTime: 0.5, EndTime: 1.2, IsPartOfWord: false },
      { Text: "всё", RomanizedText: romanizeCyrillic("всё"), StartTime: 1.2, EndTime: 1.8, IsPartOfWord: false },
      { Text: "и", RomanizedText: romanizeCyrillic("и"), StartTime: 1.8, EndTime: 2.1, IsPartOfWord: false },
      { Text: "всё", RomanizedText: romanizeCyrillic("всё"), StartTime: 2.1, EndTime: 2.7, IsPartOfWord: false },
      { Text: "забыл", RomanizedText: romanizeCyrillic("забыл"), StartTime: 2.7, EndTime: 4, IsPartOfWord: false },
    ],
  };
  const source = group.Syllables.map((syllable) => syllable.Text).join(" ");
  const plan = buildTimedGenericPlan(group, romanizeCyrillic(source), "Generic");
  assert.equal(plan?.joinedDisplayText, "Ya pomnil vsyo i vsyo zabyl");
  assert.equal(validateRenderPlan(plan!).valid, true);
});

test("a plan that cannot be carved out of the romanized line still spaces its words", () => {
  // "у" never made it through the per-syllable pass, so no chunk of it exists
  // in the romanized line. The line must not collapse into "schitayuvmore".
  const group = {
    StartTime: 0,
    EndTime: 4,
    Syllables: [
      { Text: "считаю", RomanizedText: "schitayu", StartTime: 0, EndTime: 1, IsPartOfWord: false },
      { Text: "у", RomanizedText: "у", StartTime: 1, EndTime: 1.5, IsPartOfWord: false },
      { Text: "моря", RomanizedText: "morya", StartTime: 1.5, EndTime: 3, IsPartOfWord: false },
    ],
  };
  const plan = buildTimedGenericPlan(group, romanizeCyrillic("считаю у моря"), "Generic");
  assert.equal(plan?.joinedDisplayText, "schitayu у morya");
});

test("sub-word syllables keep their word together when spacing is inferred", () => {
  // Syllable-split Cyrillic docs mark continuations with IsPartOfWord, and one
  // of them ("у" in "умирать") is a single letter.
  const group = {
    StartTime: 0,
    EndTime: 4,
    Syllables: [
      { Text: "Мо", RomanizedText: "Mo", StartTime: 0, EndTime: 0.5, IsPartOfWord: false },
      { Text: "ю", RomanizedText: "yu", StartTime: 0.5, EndTime: 0.8, IsPartOfWord: true },
      { Text: "ру", RomanizedText: "ru", StartTime: 0.8, EndTime: 1.2, IsPartOfWord: false },
      { Text: "ку", RomanizedText: "ku", StartTime: 1.2, EndTime: 1.6, IsPartOfWord: true },
      { Text: "у", RomanizedText: "у", StartTime: 1.6, EndTime: 1.9, IsPartOfWord: false },
      { Text: "ми", RomanizedText: "mi", StartTime: 1.9, EndTime: 2.4, IsPartOfWord: false },
    ],
  };
  const plan = buildTimedGenericPlan(group, romanizeCyrillic("Мою руку уми"), "Generic");
  assert.equal(plan?.joinedDisplayText, "Moyu ruku у mi");
});
