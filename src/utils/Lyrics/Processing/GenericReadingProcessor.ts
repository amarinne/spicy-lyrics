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

const PunctuationOnlyTest = /^[\p{Punctuation}\p{Symbol}]+$/u;
const CjkTextTest = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

function contextualDisplayTokens(display: string, sourceTexts: string[]): string[] {
  const punctuationSpans: Array<{ start: number; end: number }> = [];
  let searchFrom = 0;
  for (const sourceText of sourceTexts) {
    const literal = sourceText.trim();
    if (!literal) continue;
    const start = display.indexOf(literal, searchFrom);
    if (start < 0) continue;
    if (PunctuationOnlyTest.test(literal)) punctuationSpans.push({ start, end: start + literal.length });
    else if (CjkTextTest.test(literal)) continue;
    searchFrom = start + literal.length;
  }

  const tokens: string[] = [];
  const pushWords = (text: string) => tokens.push(...text.trim().split(/\s+/u).filter(Boolean));
  let cursor = 0;
  for (const span of punctuationSpans) {
    pushWords(display.slice(cursor, span.start));
    tokens.push(display.slice(span.start, span.end));
    cursor = span.end;
  }
  pushWords(display.slice(cursor));
  return tokens;
}

function hasAuthoredWhitespaceBetween(sourceTexts: string[], left: number, right: number): boolean {
  if (/\s$/u.test(sourceTexts[left] || "") || /^\s/u.test(sourceTexts[right] || "")) return true;
  for (let index = left + 1; index < right; index += 1) {
    if (/\s/u.test(sourceTexts[index] || "")) return true;
  }
  return false;
}

type TimedGenericPlanOptions = {
  mandarinWordLayout?: {
    tokenCount: number;
    continuationTokenIndices: ReadonlySet<number>;
  };
};

function withTimedBoundaries(
  units: string[],
  sourceTexts: string[],
  suppressSpaceBefore: ReadonlySet<number> = new Set(),
): string[] {
  const output = [...units];
  let previousNonempty = -1;
  for (let index = 0; index < output.length; index += 1) {
    const unit = output[index];
    if (!unit) continue;
    if (previousNonempty >= 0) {
      const currentPunctuation = PunctuationOnlyTest.test((sourceTexts[index] || "").trim());
      const previousPunctuation = PunctuationOnlyTest.test((sourceTexts[previousNonempty] || "").trim());
      const authoredWhitespace = hasAuthoredWhitespaceBetween(sourceTexts, previousNonempty, index);
      const suppressInferredSpace = suppressSpaceBefore.has(index) && !authoredWhitespace;
      if (authoredWhitespace || (!suppressInferredSpace && !currentPunctuation && !previousPunctuation)) {
        output[index] = ` ${unit}`;
      }
    }
    previousNonempty = index;
  }
  return output;
}

function joinContextualTokens(
  tokens: string[],
  start: number,
  count: number,
  continuationTokenIndices: ReadonlySet<number>,
): string {
  let output = "";
  for (let index = start; index < start + count; index += 1) {
    if (index > start && !continuationTokenIndices.has(index)) output += " ";
    output += tokens[index] || "";
  }
  return output;
}

function alignChineseTimedUnits(
  chunks: string[],
  display: string,
  sourceTexts: string[],
  options: TimedGenericPlanOptions,
): string[] {
  const tokens = contextualDisplayTokens(display, sourceTexts);
  const wordLayout = options.mandarinWordLayout;
  const continuationTokenIndices = wordLayout?.tokenCount === tokens.length
    ? wordLayout.continuationTokenIndices
    : new Set<number>();

  if (tokens.length === chunks.length) {
    return withTimedBoundaries(tokens, sourceTexts, continuationTokenIndices);
  }

  const chunkTokenCounts = chunks.map((chunk) => chunk.trim().split(/\s+/u).filter(Boolean).length);
  const timedTokenCount = chunkTokenCounts.reduce((sum, count) => sum + count, 0);
  if (timedTokenCount === tokens.length) {
    let cursor = 0;
    const suppressSpaceBeforeChunks = new Set<number>();
    const contextualChunks = chunkTokenCounts.map((count, chunkIndex) => {
      if (continuationTokenIndices.has(cursor)) suppressSpaceBeforeChunks.add(chunkIndex);
      const chunk = joinContextualTokens(tokens, cursor, count, continuationTokenIndices);
      cursor += count;
      return chunk;
    });
    return withTimedBoundaries(contextualChunks, sourceTexts, suppressSpaceBeforeChunks);
  }

  return align(chunks, display);
}

export function buildTimedGenericPlan(
  group: any,
  display: string,
  processor: string,
  options: TimedGenericPlanOptions = {},
): RenderPlan | undefined {
  const syllables = group?.Syllables;
  if (!Array.isArray(syllables) || syllables.length === 0 || !display) return undefined;
  const parsed: ParsedLine = { id: `${processor}-${group.StartTime ?? 0}-${group.EndTime ?? 0}`,
    displayText: syllables.map((s: any) => s.Text || "").join(""), paragraphProvenance: "unavailable",
    spans: syllables.map((s: any, i: number) => ({ id: String(i), rawText: s.Text || "", cleanText: s.Text || "",
      startMs: Number(s.StartTime || 0), endMs: Number(s.EndTime || 0),
      providerPartOfWord: typeof s.IsPartOfWord === "boolean" ? s.IsPartOfWord : undefined })) };
  const canonical = new DefaultCanonicalLineBuilder().build(parsed);
  const rawChunks = syllables.map((s: any) => (s.RomanizedText || s.TransliteratedText || s.Text || "").trim());
  const sourceTexts = syllables.map((s: any) => s.Text || "");
  const chunks = processor === "Chinese"
    ? alignChineseTimedUnits(rawChunks, display, sourceTexts, options)
    : align(rawChunks, display);
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
