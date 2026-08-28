import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DefaultCanonicalLineBuilder,
  DefaultScriptPartitioner,
  validateCanonicalLine,
} from "../src/utils/Lyrics/Processing/Canonical.ts";
import type { ParsedLine } from "../src/utils/Lyrics/Processing/Model.ts";

const fixture = JSON.parse(readFileSync(fileURLToPath(
  new URL("./fixtures/lyrics-reading/v1/camouflage-provider.json", import.meta.url)
), "utf8"));

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

test("canonical builder exactly maps captured provider rows", () => {
  const builder = new DefaultCanonicalLineBuilder();
  const partitioner = new DefaultScriptPartitioner();
  for (const raw of fixture.lines) {
    const canonical = builder.build(parsedLine(raw));
    const runs = partitioner.partition(canonical, { language: fixture.language });
    assert.equal(canonical.text, raw.expected.canonicalText, raw.id);
    assert.equal(canonical.spanMappings.length, raw.spans.length, raw.id);
    assert.equal(validateCanonicalLine(canonical, runs).valid, true, raw.id);
  }
});

test("script runs use code-point ranges and preserve punctuation", () => {
  const builder = new DefaultCanonicalLineBuilder();
  const partitioner = new DefaultScriptPartitioner();
  const raw = fixture.lines.find((line: any) => line.id === "camouflage-29");
  const canonical = builder.build(parsedLine(raw));
  const runs = partitioner.partition(canonical, { language: "ko" });
  assert.deepEqual(runs.map((run) => run.script), [
    "Hangul", "Whitespace", "Hangul", "Whitespace", "Hangul", "Punctuation",
    "Whitespace", "Latin", "Whitespace", "Latin", "Whitespace", "Latin",
  ]);
});
