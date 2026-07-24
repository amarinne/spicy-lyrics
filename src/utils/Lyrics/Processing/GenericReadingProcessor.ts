import { DefaultCanonicalLineBuilder } from "./Canonical.ts";
import { DefaultRenderPlanBuilder, validateRenderPlan } from "./RenderPlan.ts";
import type { ParsedLine, ReadingAnnotation, RenderPlan } from "./Model.ts";

function align(chunks: string[], display: string): string[] {
  const out = [...chunks];
  let cursor = 0;
  for (let index = 0; index < out.length; index += 1) {
    if (!out[index]) continue;
    const found = display.indexOf(out[index], cursor);
    if (found < 0) return chunks;
    out[index] = `${display.slice(cursor, found)}${out[index]}`;
    cursor = found + chunks[index].length;
  }
  if (cursor < display.length) {
    for (let index = out.length - 1; index >= 0; index -= 1) {
      if (out[index]) { out[index] += display.slice(cursor); break; }
    }
  }
  return out;
}

export function buildTimedGenericPlan(group: any, display: string, processor: string): RenderPlan | undefined {
  const syllables = group?.Syllables;
  if (!Array.isArray(syllables) || syllables.length === 0 || !display) return undefined;
  const parsed: ParsedLine = { id: `${processor}-${group.StartTime ?? 0}-${group.EndTime ?? 0}`,
    displayText: syllables.map((s: any) => s.Text || "").join(""), paragraphProvenance: "unavailable",
    spans: syllables.map((s: any, i: number) => ({ id: String(i), rawText: s.Text || "", cleanText: s.Text || "",
      startMs: Number(s.StartTime || 0), endMs: Number(s.EndTime || 0),
      providerPartOfWord: typeof s.IsPartOfWord === "boolean" ? s.IsPartOfWord : undefined })) };
  const canonical = new DefaultCanonicalLineBuilder().build(parsed);
  const chunks = align(syllables.map((s: any) => (s.RomanizedText || s.TransliteratedText || s.Text || "").trim()), display);
  const annotation: ReadingAnnotation = { processor, mode: "local", provenance: "local",
    units: canonical.spanMappings.map((mapping, index) => ({ canonicalRange: mapping.canonicalRange,
      text: chunks[index], kind: chunks[index].trim() === (syllables[index].Text || "").trim() ? "passthrough" : "transformed",
      logicalGroupId: `generic-${index}`, timingRefs: [mapping.spanId] })) };
  const plan = new DefaultRenderPlanBuilder().build(parsed, canonical, [annotation]);
  return validateRenderPlan(plan).valid ? plan : undefined;
}

export function buildLineFallbackPlan(source: string, display: string, id: string): RenderPlan {
  const parsed: ParsedLine = { id, displayText: source, paragraphProvenance: "lineBoundary",
    spans: [{ id: "line", rawText: source, cleanText: source, startMs: 0, endMs: 0, providerPartOfWord: false }] };
  const canonical = new DefaultCanonicalLineBuilder().build(parsed);
  const annotation: ReadingAnnotation = { processor: "Fallback", mode: "line", provenance: "provider",
    units: [{ canonicalRange: { startCp: 0, endCp: Array.from(canonical.text).length }, text: display,
      kind: "transformed", logicalGroupId: "line", timingRefs: [] }] };
  return new DefaultRenderPlanBuilder().build(parsed, canonical, [annotation]);
}
