import { codePointLength, isValidCodePointRange } from "./CodePoint.ts";
import { resolveProviderBoundaries } from "./ProviderBoundary.ts";
import type {
  CanonicalLine,
  CanonicalLineBuilder,
  LanguageContext,
  ParsedLine,
  ScriptPartitioner,
  ScriptRun,
  ValidationResult,
} from "./Model.ts";

export class DefaultCanonicalLineBuilder implements CanonicalLineBuilder {
  build(line: ParsedLine): CanonicalLine {
    return resolveProviderBoundaries(line).canonical;
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
  if (line.joins.length > 0) {
    if (line.joins.length !== Math.max(0, line.spanMappings.length - 1)) {
      errors.push(`join count:${line.joins.length}`);
    }
    line.joins.forEach((join, index) => {
      if (line.spanMappings[index]?.spanId !== join.afterSpanId) errors.push(`join owner:${join.afterSpanId}`);
      if (join.relation === "unknown") errors.push(`unknown join:${join.afterSpanId}`);
    });
  }
  return { valid: errors.length === 0, errors };
}
