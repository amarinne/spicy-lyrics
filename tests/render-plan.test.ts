import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DefaultCanonicalLineBuilder } from "../src/utils/Lyrics/Processing/Canonical.ts";
import { annotateKoreanLine } from "../src/utils/Lyrics/Processing/Korean/KoreanAnnotationProcessor.ts";
import { DefaultRenderPlanBuilder, validateRenderPlan } from "../src/utils/Lyrics/Processing/RenderPlan.ts";
import { buildTimedGenericPlan } from "../src/utils/Lyrics/Processing/GenericReadingProcessor.ts";
import { buildMandarinWordLayout } from "../src/utils/Lyrics/Fork/Romanization.ts";
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
