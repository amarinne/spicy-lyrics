import assert from "node:assert/strict";
import { test } from "node:test";
import { DefaultCanonicalLineBuilder } from "../src/utils/Lyrics/Processing/Canonical.ts";
import { annotateJapaneseLine } from "../src/utils/Lyrics/Processing/Japanese/JapaneseAnnotationProcessor.ts";
import { DefaultRenderPlanBuilder } from "../src/utils/Lyrics/Processing/RenderPlan.ts";

test("Japanese annotation keeps split spans as unique timing owners", async () => {
  const line = { id: "jp", displayText: "だんだん剥がれてく", paragraphProvenance: "lineBoundary" as const,
    spans: ["だん", "だん", "剥", "がれて", "く"].map((text, index) => ({ id: String(index), rawText: text,
      cleanText: text, startMs: index * 100, endMs: (index + 1) * 100, providerPartOfWord: true })) };
  const canonical = new DefaultCanonicalLineBuilder().build(line);
  const annotation = await annotateJapaneseLine(canonical, "dandan hagareteku");
  assert.ok(annotation);
  const plan = new DefaultRenderPlanBuilder().build(line, canonical, [annotation!]);
  assert.equal(plan.timedReadingUnits.length, 5);
  assert.equal(new Set(plan.timedReadingUnits.map((unit) => unit.spanId)).size, 5);
  assert.equal(plan.joinedDisplayText.length > 0, true);
});

test("Japanese furigana ranges are exported as code-point coordinates", async () => {
  const line = { id: "astral-jp", displayText: "😀今日", paragraphProvenance: "lineBoundary" as const,
    spans: [{ id: "0", rawText: "😀", cleanText: "😀", startMs: 0, endMs: 100, providerPartOfWord: true },
      { id: "1", rawText: "今日", cleanText: "今日", startMs: 100, endMs: 200, providerPartOfWord: false }] };
  const canonical = new DefaultCanonicalLineBuilder().build(line);
  const annotation = await annotateJapaneseLine(canonical, "😀 kyou");
  for (const segment of (annotation?.furigana || []) as any[]) {
    assert.ok(segment.canonicalRange.startCp >= 1);
    assert.ok(segment.canonicalRange.endCp <= 3);
  }
});

test("inline Japanese parentheticals remain authored lyric text", () => {
  const text = "天(そら)";
  const canonical = new DefaultCanonicalLineBuilder().build({
    id: "inline-parenthetical",
    displayText: text,
    paragraphProvenance: "lineBoundary",
    spans: [{ id: "0", rawText: text, cleanText: text, startMs: 0, endMs: 1000, providerPartOfWord: false }],
  });
  assert.equal(canonical.text, text);
  assert.deepEqual(canonical.spanMappings[0].canonicalRange, { startCp: 0, endCp: Array.from(text).length });
});
