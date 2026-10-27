import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { applySyllableBoundaries, resolveProviderBoundaries } from "../src/utils/Lyrics/Processing/ProviderBoundary.ts";
import type { ParsedLine } from "../src/utils/Lyrics/Processing/Model.ts";

const path = fileURLToPath(new URL(
  "./fixtures/lyrics-reading/v2/provider-boundary-corpus.json",
  import.meta.url
));
const fixture = JSON.parse(readFileSync(path, "utf8"));

function parsedLine(raw: any): ParsedLine {
  return {
    id: raw.id,
    displayText: raw.displayText,
    paragraphProvenance: "unavailable",
    spans: raw.spans.map((span: [string, boolean | null, number, number], index: number) => ({
      id: String(index),
      rawText: span[0],
      cleanText: span[0],
      providerPartOfWord: span[1] == null ? undefined : span[1],
      startMs: span[2],
      endMs: span[3],
    })),
  };
}

test("provider boundary corpus matches mobile contract", () => {
  assert.equal(fixture.schemaVersion, 2);
  for (const raw of fixture.lines) {
    const expected = raw.expected;
    const resolution = resolveProviderBoundaries(parsedLine(raw));
    assert.equal(resolution.canonical.text, expected.canonicalText, raw.id);
    assert.equal(resolution.completeLineAccepted, expected.completeLineAccepted, raw.id);
    assert.deepEqual(resolution.diagnostics, expected.diagnostics, `${raw.id} diagnostics`);
    assert.deepEqual(
      resolution.canonical.spanMappings.map((mapping) => [
        mapping.canonicalRange.startCp,
        mapping.canonicalRange.endCp,
      ]),
      expected.spanMappings,
      `${raw.id} mappings`
    );
    assert.deepEqual(
      resolution.canonical.boundaries.map((boundary) => [
        boundary.offsetCp,
        boundary.kind,
        boundary.provenance,
      ]),
      expected.boundaries,
      `${raw.id} boundaries`
    );
    assert.deepEqual(
      resolution.canonical.joins.map((join) => [join.relation, join.provenance]),
      expected.joins,
      `${raw.id} joins`
    );
  }
});

test("documents without romanization work still get word boundaries", () => {
  // Word-level syllables with no display text: the no-work cache path relies
  // on this stamp for visible word spacing.
  const lyrics = {
    Type: "Syllable",
    Content: [
      {
        Type: "Vocal",
        Lead: {
          StartTime: 0,
          EndTime: 1000,
          Syllables: ["Never", "thought", "that", "I'd", "find"].map((Text) => ({ Text, IsPartOfWord: false })),
        },
      },
      {
        Lead: {
          StartTime: 1000,
          EndTime: 2000,
          Syllables: [
            { Text: "un", IsPartOfWord: true },
            { Text: "der", IsPartOfWord: true },
            { Text: "stands", IsPartOfWord: false },
          ],
        },
        Background: [{ StartTime: 0, EndTime: 1, Syllables: [{ Text: "oh", IsPartOfWord: false }] }],
      },
      { Type: "Instrumental", Lead: { Syllables: [{ Text: "x", IsPartOfWord: false }] } },
    ],
  };
  applySyllableBoundaries(lyrics as any);
  const first = (lyrics.Content[0] as any).Lead;
  assert.deepEqual(first.Syllables.map((s: any) => s.BoundaryAfter), [true, true, true, true, false]);
  assert.equal(first.Text, "Never thought that I'd find");
  const second = (lyrics.Content[1] as any).Lead;
  assert.deepEqual(second.Syllables.map((s: any) => s.BoundaryAfter), [false, false, false]);
  assert.equal((lyrics.Content[1] as any).Background[0].Syllables[0].BoundaryAfter, false);
  assert.equal((lyrics.Content[2] as any).Lead.Syllables[0].BoundaryAfter, undefined);
});
