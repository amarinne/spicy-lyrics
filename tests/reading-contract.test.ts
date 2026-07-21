import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  codePointLength,
  codePointOffsetToUtf16Index,
  codePointSlice,
  isValidCodePointRange,
  utf16IndexToCodePointOffset,
} from "../src/utils/Lyrics/Processing/CodePoint.ts";
import {
  DefaultCanonicalLineBuilder,
  DefaultScriptPartitioner,
} from "../src/utils/Lyrics/Processing/Canonical.ts";
import {
  annotateKoreanLine,
  joinReadingUnits,
} from "../src/utils/Lyrics/Processing/Korean/KoreanAnnotationProcessor.ts";
import type { ParsedDocument, ParsedLine } from "../src/utils/Lyrics/Processing/Model.ts";
import { processJapanesePackageLine } from "../src/utils/Lyrics/Processing/Japanese/JapanesePackageProcessor.ts";

test("reading contract uses Unicode code-point coordinates", () => {
  const text = "A😀한국";
  assert.equal(codePointLength(text), 4);
  assert.equal(codePointSlice(text, { startCp: 1, endCp: 3 }), "😀한");
  assert.equal(codePointOffsetToUtf16Index(text, 2), 3);
  assert.equal(utf16IndexToCodePointOffset(text, 3), 2);
  assert.equal(isValidCodePointRange(text, { startCp: 0, endCp: 4 }), true);
  assert.equal(isValidCodePointRange(text, { startCp: 3, endCp: 5 }), false);
});

test("parsed contract represents unavailable paragraph provenance explicitly", () => {
  const document: ParsedDocument = {
    id: "provider-capture",
    language: "ko",
    lines: [{
      id: "line-1",
      displayText: "주저 없이 다, Probably delete it",
      paragraphProvenance: "unavailable",
      spans: [],
    }],
  };

  assert.equal(document.lines[0].paragraphId, undefined);
  assert.equal(document.lines[0].paragraphProvenance, "unavailable");
});

function parsedLine(raw: any): ParsedLine {
  return {
    id: raw.id,
    displayText: raw.expected.canonicalText,
    paragraphProvenance: "unavailable",
    spans: raw.spans.map((span: [string, boolean, number, number], index: number) => ({
      id: `${raw.id}-s${index}`,
      rawText: span[0],
      cleanText: span[0],
      providerPartOfWord: span[1],
      startMs: span[2],
      endMs: span[3],
    })),
  };
}

// The cross-platform contract: for every fixture line, this platform's pipeline must
// reproduce the shared expected values exactly. The Android repo asserts the same
// fixtures (byte-identical copies) through its own pipeline (ReadingContractTest.java).
async function assertFixtureSemantics(name: string) {
  const path = fileURLToPath(new URL(`./fixtures/lyrics-reading/v1/${name}`, import.meta.url));
  const fixture = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(fixture.schemaVersion, 1);
  const builder = new DefaultCanonicalLineBuilder();
  const partitioner = new DefaultScriptPartitioner();
  for (const raw of fixture.lines) {
    const expected = raw.expected;
    const canonical = builder.build(parsedLine(raw));
    assert.equal(canonical.text, expected.canonicalText, raw.id);
    assert.deepEqual(
      canonical.boundaries.map((b: any) => [b.offsetCp, b.kind]),
      expected.boundaries,
      `${raw.id} boundaries`
    );
    assert.deepEqual(
      canonical.spanMappings.map((m: any) => [m.canonicalRange.startCp, m.canonicalRange.endCp]),
      expected.spanMappings,
      `${raw.id} spanMappings`
    );
    const runs = partitioner.partition(canonical, { language: fixture.language });
    assert.deepEqual(
      runs.map((r: any) => [r.canonicalRange.startCp, r.canonicalRange.endCp, r.script]),
      expected.scriptRuns,
      `${raw.id} scriptRuns`
    );
    if (expected.readingMode) {
      const annotation = annotateKoreanLine(canonical, expected.readingMode);
      assert.deepEqual(
        annotation.units.map((u) => ({
          text: u.text,
          kind: u.kind,
          startCp: u.canonicalRange.startCp,
          endCp: u.canonicalRange.endCp,
        })),
        expected.readingUnits,
        `${raw.id} readingUnits`
      );
      annotation.units.forEach((u, index) => {
        assert.deepEqual(u.timingRefs, [`${raw.id}-s${expected.timedReadingUnits[index][0]}`], raw.id);
        assert.equal(u.text, expected.timedReadingUnits[index][1], raw.id);
      });
      assert.equal(joinReadingUnits(annotation), expected.joinedDisplayText, raw.id);
    }
    if (expected.pronunciationDisplays) {
      for (const mode of ["rrPronunciation", "vnPronunciation"] as const) {
        const annotation = annotateKoreanLine(canonical, mode);
        assert.equal(joinReadingUnits(annotation), expected.pronunciationDisplays[mode], `${raw.id} ${mode}`);
      }
    }
    if (expected.japanesePlan) {
      const syllables = raw.spans.map((span: [string]) => ({ Text: span[0] }));
      const spans = raw.expected.spanMappings.map((range: [number, number], index: number) => ({
        index, start: range[0], end: range[1], rawText: raw.spans[index][0],
      }));
      const result = await processJapanesePackageLine(expected.canonicalText, syllables, spans, syllables);
      assert.equal(result.plan.joinedDisplayText, expected.japanesePlan.joinedDisplayText, `${raw.id} Japanese display`);
      assert.deepEqual(result.plan.timedReadingUnits.map((unit) => unit.spanId),
        expected.japanesePlan.timedSpanIds, `${raw.id} Japanese owners`);
    }
  }
}

test("camouflage fixture semantics match shared expectations", async () => {
  await assertFixtureSemantics("camouflage-provider.json");
});

test("script corpus fixture semantics match shared expectations", async () => {
  await assertFixtureSemantics("script-corpus.json");
});
