import {
  normalizeKoreanDisplaySource,
  romanizeKoreanDisplayPieces,
  romanizeKoreanForDisplay,
  type KoreanDisplayMode,
  type KoreanSyllableLike,
} from "../../Fork/Romanization.ts";
import { cleanInvisiblesPreserveEdges } from "../../Fork/TextDetection.ts";
import { canonicalTextFromSyllables } from "../ProviderBoundary.ts";
import type {
  NormalizedBoundary,
  NormalizedLine,
  NormalizedSpanRef,
  ReadingGroup,
  ReadingPlan,
  SpanReading,
  TextRange,
} from "../Model.ts";

function normalizeSpanText(text: string): string {
  return cleanInvisiblesPreserveEdges((text || "").normalize("NFKC")).replace(/[ \t]{2,}/g, " ");
}

function rangesOverlap(left: TextRange, right: TextRange): boolean {
  return left.startCp < right.endCp && right.startCp < left.endCp;
}

export function buildKoreanNormalizedLine(
  syllables: KoreanSyllableLike[],
  displayText = ""
): NormalizedLine {
  const normalizedSyllables = syllables.map((syllable) => ({
    Text: normalizeSpanText(syllable?.Text || ""),
    IsPartOfWord: syllable?.IsPartOfWord,
  }));
  const canonical = canonicalTextFromSyllables(normalizedSyllables, displayText).canonical;
  const text = normalizeKoreanDisplaySource(canonical.text);
  const spans: NormalizedSpanRef[] = canonical.spanMappings.map((mapping, spanId) => ({
    spanId,
    source: mapping.canonicalRange,
  }));
  const boundaries: NormalizedBoundary[] = canonical.boundaries.map((boundary) => ({
    offsetCp: boundary.offsetCp,
    kind: boundary.kind === "paragraph" ? "paragraph"
      : boundary.kind === "script" ? "script"
        : boundary.kind === "inferred" ? "inferred" : "whitespace",
  }));

  return { text, spans, boundaries };
}

function readingForRange(pieces: string[], range: TextRange): string {
  return pieces.slice(range.startCp, range.endCp).join("");
}

function hasSpaceBefore(sourceCodePoints: string[], startCp: number): boolean {
  return startCp > 0 && /\s/.test(sourceCodePoints[startCp - 1] || "");
}

function buildReadingGroups(
  normalized: NormalizedLine,
  pieces: string[]
): ReadingGroup[] {
  const sourceCodePoints = Array.from(normalized.text);
  const groups: ReadingGroup[] = [];
  let cursor = 0;

  while (cursor < sourceCodePoints.length) {
    while (cursor < sourceCodePoints.length && /\s/.test(sourceCodePoints[cursor])) cursor += 1;
    if (cursor >= sourceCodePoints.length) break;

    const startCp = cursor;
    while (cursor < sourceCodePoints.length && !/\s/.test(sourceCodePoints[cursor])) cursor += 1;
    const source = { startCp, endCp: cursor };
    const spanIds = normalized.spans
      .filter((span) => rangesOverlap(span.source, source))
      .map((span) => span.spanId);

    groups.push({
      source,
      spanIds,
      text: readingForRange(pieces, source),
      spaceBefore: hasSpaceBefore(sourceCodePoints, startCp),
    });
  }

  return groups;
}

export function buildKoreanReadingPlan(
  syllables: KoreanSyllableLike[],
  mode: KoreanDisplayMode = "rrStandard",
  displayText = ""
): ReadingPlan {
  const normalized = buildKoreanNormalizedLine(syllables, displayText);
  const pieces = romanizeKoreanDisplayPieces(normalized.text, mode);
  const sourceCodePoints = Array.from(normalized.text);
  const spanReadings: SpanReading[] = normalized.spans.map((span) => ({
    spanId: span.spanId,
    source: span.source,
    text: readingForRange(pieces, span.source),
    spaceBefore: hasSpaceBefore(sourceCodePoints, span.source.startCp),
  }));

  return {
    processor: "Korean",
    mode,
    normalized,
    displayText: romanizeKoreanForDisplay(normalized.text, mode).display,
    groups: buildReadingGroups(normalized, pieces),
    spanReadings,
  };
}
