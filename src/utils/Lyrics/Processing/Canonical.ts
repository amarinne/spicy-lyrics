import { cleanInvisiblesPreserveEdges } from "../Fork/TextDetection.ts";
import { codePointLength, isValidCodePointRange } from "./CodePoint.ts";
import type {
  Boundary,
  CanonicalLine,
  CanonicalLineBuilder,
  LanguageContext,
  ParsedLine,
  ScriptPartitioner,
  ScriptRun,
  ValidationResult,
} from "./Model.ts";

const normalizeSpan = (text: string): string => cleanInvisiblesPreserveEdges((text || "").normalize("NFKC"));
const coreText = (text: string): string => text.replace(/^\s+|\s+$/gu, "");

export class DefaultCanonicalLineBuilder implements CanonicalLineBuilder {
  build(line: ParsedLine): CanonicalLine {
    let text = normalizeSpan(line.displayText);
    if (!text) text = line.spans.map((span) => coreText(normalizeSpan(span.rawText || span.cleanText))).join("");
    const spanMappings: CanonicalLine["spanMappings"][number][] = [];
    const boundaries: Boundary[] = [];
    let searchUtf16 = 0;
    let previousEndUtf16 = 0;
    let previousRaw = "";

    line.spans.forEach((span, index) => {
      const normalized = normalizeSpan(span.rawText || span.cleanText);
      const clean = coreText(normalized);
      let found = clean ? text.indexOf(clean, searchUtf16) : searchUtf16;
      if (found < 0) found = Math.min(searchUtf16, text.length);
      const endUtf16 = Math.min(text.length, found + clean.length);
      if (index > 0 && found > previousEndUtf16) {
        const gap = text.slice(previousEndUtf16, found);
        const whitespaceIndex = Array.from(gap).findIndex((char) => /\s/u.test(char));
        if (whitespaceIndex >= 0) {
          const offsetUtf16 = previousEndUtf16 + Array.from(gap).slice(0, whitespaceIndex).join("").length;
          const explicit = /^\s/u.test(normalized) || /\s$/u.test(previousRaw);
          boundaries.push({
            offsetCp: codePointLength(text.slice(0, offsetUtf16)),
            kind: explicit ? "explicitWhitespace" : "inferred",
            confidence: 1,
            provenance: explicit ? "providerTextWhitespace" : "adapterDisplayText",
          });
        }
      }
      spanMappings.push({
        spanId: span.id,
        canonicalRange: {
          startCp: codePointLength(text.slice(0, found)),
          endCp: codePointLength(text.slice(0, endUtf16)),
        },
      });
      searchUtf16 = endUtf16;
      previousEndUtf16 = endUtf16;
      previousRaw = normalized;
    });

    return { lineId: line.id, text, spanMappings, boundaries };
  }
}

function scriptOf(char: string): string {
  if (/\s/u.test(char)) return "Whitespace";
  if (/\p{Script=Hangul}/u.test(char)) return "Hangul";
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(char)) return "Kana";
  if (/\p{Script=Han}/u.test(char)) return "Han";
  if (/\p{Script=Latin}/u.test(char)) return "Latin";
  if (/\p{Script=Cyrillic}/u.test(char)) return "Cyrillic";
  if (/\p{Script=Greek}/u.test(char)) return "Greek";
  if (/\p{Punctuation}|\p{Symbol}/u.test(char)) return "Punctuation";
  return "Other";
}

export class DefaultScriptPartitioner implements ScriptPartitioner {
  partition(line: CanonicalLine, _context: LanguageContext): readonly ScriptRun[] {
    const chars = Array.from(line.text);
    if (chars.length === 0) return [];
    const runs: ScriptRun[] = [];
    let startCp = 0;
    let script = scriptOf(chars[0]);
    for (let offsetCp = 1; offsetCp <= chars.length; offsetCp += 1) {
      const next = offsetCp < chars.length ? scriptOf(chars[offsetCp]) : undefined;
      if (next !== script) {
        runs.push({ script, canonicalRange: { startCp, endCp: offsetCp } });
        startCp = offsetCp;
        script = next || "Other";
      }
    }
    return runs;
  }
}

export function validateCanonicalLine(line: CanonicalLine, runs: readonly ScriptRun[]): ValidationResult {
  const errors: string[] = [];
  let mappingEnd = 0;
  for (const mapping of line.spanMappings) {
    if (!isValidCodePointRange(line.text, mapping.canonicalRange)) errors.push(`invalid mapping:${mapping.spanId}`);
    if (mapping.canonicalRange.startCp < mappingEnd) errors.push(`overlapping mapping:${mapping.spanId}`);
    mappingEnd = mapping.canonicalRange.endCp;
  }
  let runEnd = 0;
  for (const run of runs) {
    if (!isValidCodePointRange(line.text, run.canonicalRange)) errors.push(`invalid run:${run.script}`);
    if (run.canonicalRange.startCp !== runEnd) errors.push(`run gap:${runEnd}`);
    runEnd = run.canonicalRange.endCp;
  }
  if (runEnd !== codePointLength(line.text)) errors.push(`run coverage:${runEnd}`);
  for (const boundary of line.boundaries) {
    if (boundary.offsetCp < 0 || boundary.offsetCp > codePointLength(line.text)) errors.push("invalid boundary");
  }
  return { valid: errors.length === 0, errors };
}
