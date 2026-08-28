import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DefaultCanonicalLineBuilder } from "../src/utils/Lyrics/Processing/Canonical.ts";
import {
  annotateKoreanLine,
  joinReadingUnits,
} from "../src/utils/Lyrics/Processing/Korean/KoreanAnnotationProcessor.ts";
import { romanizeKoreanForDisplay, type KoreanDisplayMode } from "../src/utils/Lyrics/Fork/Romanization.ts";
import type { ParsedLine } from "../src/utils/Lyrics/Processing/Model.ts";

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL(
  "./fixtures/lyrics-reading/v1/camouflage-provider.json", import.meta.url
)), "utf8"));

function parsedLine(raw: any): ParsedLine {
  return { id: raw.id, displayText: raw.expected.canonicalText, paragraphProvenance: "unavailable",
    spans: raw.spans.map((s: any[], i: number) => ({ id: `${raw.id}-s${i}`, rawText: s[0], cleanText: s[0],
      providerPartOfWord: s[1], startMs: s[2], endMs: s[3] })) };
}

test("Korean annotation derives joined display from timed units in all modes", () => {
  const builder = new DefaultCanonicalLineBuilder();
  const modes: KoreanDisplayMode[] = ["wordTranslit", "rrStandard", "rrPronunciation", "vnPronunciation"];
  for (const raw of fixture.lines.filter((line: any) => /[가-힯]/u.test(line.expected.canonicalText))) {
    const canonical = builder.build(parsedLine(raw));
    for (const mode of modes) {
      const annotation = annotateKoreanLine(canonical, mode);
      assert.equal(joinReadingUnits(annotation), romanizeKoreanForDisplay(canonical.text, mode).display, `${raw.id}:${mode}`);
      assert.deepEqual(annotation.units.flatMap((unit) => unit.timingRefs), canonical.spanMappings.map((m) => m.spanId));
    }
  }
});

test("mixed English is typed passthrough and remains source ordered", () => {
  const raw = fixture.lines.find((line: any) => line.id === "camouflage-29");
  const annotation = annotateKoreanLine(new DefaultCanonicalLineBuilder().build(parsedLine(raw)), "vnPronunciation");
  assert.equal(joinReadingUnits(annotation), "jujo opssi da, Probably delete it");
  assert.deepEqual(annotation.units.slice(-3).map((unit) => [unit.kind, unit.text.trim()]), [
    ["passthrough", "Probably"], ["passthrough", "delete"], ["passthrough", "it"],
  ]);
});

test("Korean timing units follow the whitespace-normalized source", () => {
  const text = "사랑합니다";
  const parsed: ParsedLine = {
    id: "normalized-spacing",
    displayText: text,
    paragraphProvenance: "unavailable",
    spans: Array.from(text).map((char, index) => ({
      id: String(index), rawText: char, cleanText: char, startMs: index, endMs: index + 1,
      providerPartOfWord: true,
    })),
  };
  const annotation = annotateKoreanLine(new DefaultCanonicalLineBuilder().build(parsed), "rrStandard");
  assert.equal(joinReadingUnits(annotation), "saranghapnida");
  assert.deepEqual(annotation.units.map((unit) => unit.text), ["sa", "rang", "hap", "ni", "da"]);
});

test("Korean readability spacing does not split adverbial 하게", () => {
  const text = "어색하게 마주 앉아";
  const parsed: ParsedLine = {
    id: "adverbial-hage",
    displayText: text,
    paragraphProvenance: "unavailable",
    spans: Array.from(text).map((char, index) => ({
      id: String(index), rawText: char, cleanText: char, startMs: index, endMs: index + 1,
      providerPartOfWord: true,
    })),
  };
  const annotation = annotateKoreanLine(new DefaultCanonicalLineBuilder().build(parsed), "rrPronunciation");
  assert.equal(joinReadingUnits(annotation), "eosaekage maju anja");
});

test("Korean reading spacing follows authored lyric boundaries", () => {
  const spans = ["그대 ", "아무런 ", "말", "도 ", "하", "지 ", "마", "요"];
  const parsed: ParsedLine = {
    id: "authored-spacing",
    displayText: spans.join(""),
    paragraphProvenance: "unavailable",
    spans: spans.map((text, index) => ({
      id: String(index), rawText: text, cleanText: text, startMs: index, endMs: index + 1,
      providerPartOfWord: false,
    })),
  };
  const annotation = annotateKoreanLine(new DefaultCanonicalLineBuilder().build(parsed), "rrPronunciation");
  assert.equal(joinReadingUnits(annotation), "geudae amureon maldo haji mayo");
  assert.deepEqual(annotation.units.map((unit) => unit.text), [
    "geudae", " amureon", " mal", "do", " ha", "ji", " ma", "yo",
  ]);
});
