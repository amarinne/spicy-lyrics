import { cleanInvisiblesPreserveEdges } from "../Fork/TextDetection.ts";
import { codePointLength } from "./CodePoint.ts";
import type {
  Boundary,
  BoundaryKind,
  CanonicalLine,
  JoinRelation,
  ParsedLine,
  SourceSpan,
  SpanJoinEvidence,
} from "./Model.ts";

export type ProviderBoundaryResolution = {
  readonly canonical: CanonicalLine;
  readonly completeLineAccepted: boolean;
  readonly diagnostics: readonly string[];
};

type SpanState = { source: SourceSpan; normalizedRaw: string; core: string };
type ResolvedJoin = {
  relation: JoinRelation;
  kind: BoundaryKind;
  confidence: number;
  provenance: string;
};

const normalize = (value: string | undefined): string =>
  cleanInvisiblesPreserveEdges((value || "").normalize("NFKC"));
const coreText = (value: string): string => value.replace(/^\s+|\s+$/gu, "");
const onlyWhitespace = (value: string): boolean => /^\s*$/u.test(value);
const firstChar = (value: string): string => Array.from(value)[0] || "";
const lastChar = (value: string): string => Array.from(value).at(-1) || "";
const isJapanese = (char: string): boolean => /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(char);
const isLatinOrDigit = (char: string): boolean => /\p{Script=Latin}|\p{Number}/u.test(char);
const isLetterScript = (char: string): boolean =>
  /\p{Script=Latin}|\p{Script=Hangul}|\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Cyrillic}|\p{Script=Greek}/u.test(char);
const scriptName = (char: string): string => {
  for (const [name, pattern] of [
    ["Latin", /\p{Script=Latin}/u], ["Hangul", /\p{Script=Hangul}/u],
    ["Han", /\p{Script=Han}/u], ["Hiragana", /\p{Script=Hiragana}/u],
    ["Katakana", /\p{Script=Katakana}/u], ["Cyrillic", /\p{Script=Cyrillic}/u],
    ["Greek", /\p{Script=Greek}/u],
  ] as const) if (pattern.test(char)) return name;
  return "Other";
};
const isClosingPunctuation = (char: string): boolean =>
  /[\p{Pe}\p{Pf},.;:!?、。！？〉》」』】〕〗〙〛]/u.test(char);
const isOpeningPunctuation = (char: string): boolean =>
  /[\p{Ps}\p{Pi}〈《「『【〔〖〘〚]/u.test(char);
const isJoinPunctuation = (char: string): boolean => /['’\-‐‑]/u.test(char);

function attached(confidence: number, provenance: string): ResolvedJoin {
  return { relation: "attached", kind: "inferred", confidence, provenance };
}

function boundary(kind: BoundaryKind, confidence: number, provenance: string): ResolvedJoin {
  return { relation: "boundary", kind, confidence, provenance };
}

function scriptRelation(previous: string, next: string): JoinRelation {
  const previousChar = lastChar(previous);
  const nextChar = firstChar(next);
  if (!previousChar || !nextChar) return "unknown";
  if ((previous === "1" || previous === "2") && nextChar === "人") return "attached";
  if (isClosingPunctuation(nextChar) || isJoinPunctuation(nextChar)
      || isOpeningPunctuation(previousChar) || isJoinPunctuation(previousChar)) return "attached";
  const previousJapanese = isJapanese(previousChar);
  const nextJapanese = isJapanese(nextChar);
  if (previousJapanese && nextJapanese) return "attached";
  if ((isLatinOrDigit(previousChar) && nextJapanese)
      || (previousJapanese && isLatinOrDigit(nextChar))) return "boundary";
  if (scriptName(previousChar) !== scriptName(nextChar)
      && isLetterScript(previousChar) && isLetterScript(nextChar)) return "boundary";
  return "unknown";
}

function alignCompleteLine(displayText: string, spans: readonly SpanState[]): {
  separators: string[];
  hasWhitespace: boolean;
} | undefined {
  const candidate = coreText(displayText);
  if (!candidate || spans.length === 0) return undefined;
  const separators: string[] = [];
  let cursor = 0;
  for (let index = 0; index < spans.length; index += 1) {
    const core = spans[index].core;
    if (!core) return undefined;
    const found = candidate.indexOf(core, cursor);
    if (found < 0 || !onlyWhitespace(candidate.slice(cursor, found))) return undefined;
    if (index > 0) separators.push(candidate.slice(cursor, found));
    cursor = found + core.length;
  }
  if (!onlyWhitespace(candidate.slice(cursor))) return undefined;
  return { separators, hasWhitespace: /\s/u.test(candidate) };
}

function resolveJoin(current: SpanState, next: SpanState, providerSeparator: string | undefined,
  completeLineHasWhitespace: boolean): ResolvedJoin {
  if (/\s$/u.test(current.normalizedRaw) || /^\s/u.test(next.normalizedRaw)) {
    return boundary("explicitWhitespace", 1, "rawEdgeWhitespace");
  }
  if (providerSeparator != null && providerSeparator.length > 0 && onlyWhitespace(providerSeparator)) {
    return boundary("inferred", 1, "completeProviderLine");
  }
  if (current.source.paragraphId && next.source.paragraphId
      && current.source.paragraphId !== next.source.paragraphId) {
    return boundary("paragraph", 1, "providerParagraph");
  }
  const script = scriptRelation(current.core, next.core);
  if (script === "attached") return attached(0.9, "scriptFallback");
  if (script === "boundary") return boundary("script", 0.9, "scriptFallback");
  if (providerSeparator === "" && completeLineHasWhitespace) {
    return attached(0.85, "completeProviderLineCompact");
  }
  if (current.source.providerPartOfWord != null) {
    return current.source.providerPartOfWord
      ? attached(0.7, "providerFlagAfterSpan")
      : boundary("inferred", 0.7, "providerFlagAfterSpan");
  }
  if (providerSeparator != null) return attached(0.5, "completeProviderLineCompact");
  return { relation: "unknown", kind: "inferred", confidence: 0, provenance: "unresolved" };
}

export function resolveProviderBoundaries(line: ParsedLine): ProviderBoundaryResolution {
  const spans = line.spans.map((source): SpanState => {
    const normalizedRaw = normalize(source.rawText || source.cleanText);
    return { source, normalizedRaw, core: coreText(normalizedRaw) };
  });
  const normalizedDisplay = normalize(line.displayText);
  const complete = alignCompleteLine(normalizedDisplay, spans);
  const diagnostics: string[] = [];
  if (normalizedDisplay && !complete) diagnostics.push("invalidCompleteProviderLine");
  let text = "";
  const spanMappings: CanonicalLine["spanMappings"][number][] = [];
  const boundaries: Boundary[] = [];
  const joins: SpanJoinEvidence[] = [];

  spans.forEach((span, index) => {
    const startCp = codePointLength(text);
    text += span.core;
    const endCp = codePointLength(text);
    spanMappings.push({ spanId: span.source.id, canonicalRange: { startCp, endCp } });
    if (index >= spans.length - 1) return;
    const join = resolveJoin(span, spans[index + 1], complete?.separators[index], complete?.hasWhitespace === true);
    joins.push({ afterSpanId: span.source.id, relation: join.relation,
      confidence: join.confidence, provenance: join.provenance });
    if (join.relation === "boundary") {
      boundaries.push({ offsetCp: codePointLength(text), kind: join.kind,
        confidence: join.confidence, provenance: join.provenance });
      text += " ";
    } else if (join.relation === "unknown") {
      diagnostics.push(`unknownJoinAfter:${span.source.id}`);
    }
  });

  return {
    canonical: { lineId: line.id, text, spanMappings, boundaries, joins },
    completeLineAccepted: complete != null,
    diagnostics,
  };
}

export function canonicalTextFromSyllables(
  syllables: readonly { Text?: string; IsPartOfWord?: boolean }[],
  displayText = "",
  lineId = "syllable-line"
): ProviderBoundaryResolution {
  return resolveProviderBoundaries({
    id: lineId,
    displayText,
    paragraphProvenance: "unavailable",
    spans: syllables.map((syllable, index) => ({
      id: String(index),
      rawText: syllable?.Text || "",
      cleanText: syllable?.Text || "",
      startMs: 0,
      endMs: 0,
      providerPartOfWord: typeof syllable?.IsPartOfWord === "boolean" ? syllable.IsPartOfWord : undefined,
    })),
  });
}
