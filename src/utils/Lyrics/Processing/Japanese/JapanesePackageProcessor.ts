import {
  loadBrowserJmdictFurigana,
  loadBrowserUniDicTokenizer,
  processJapaneseLine,
  type BoundaryEvidence,
  type FuriganaSpan as PackageFuriganaSpan,
  type SourceSpan as PackageSourceSpan,
} from "japanese-lyrics-processor";
import type { JapaneseReadable, JapaneseTimedTextSpan } from "../../Reading/JapaneseReading.ts";
import type { RenderPlan } from "../Model.ts";

let dependencies: Promise<{ tokenizer: Awaited<ReturnType<typeof loadBrowserUniDicTokenizer>>; jmdict: Awaited<ReturnType<typeof loadBrowserJmdictFurigana>> }> | undefined;
const loadDependencies = () => dependencies ??= Promise.all([loadBrowserUniDicTokenizer(), loadBrowserJmdictFurigana()]).then(([tokenizer, jmdict]) => ({ tokenizer, jmdict }));
const cp = (text: string, utf16: number): number => Array.from(text.slice(0, utf16)).length;
const utf16 = (text: string, codePoints: number): number => Array.from(text).slice(0, codePoints).join("").length;

function providerFurigana(text: string, syllables: JapaneseReadable[], spans: JapaneseTimedTextSpan[]): PackageFuriganaSpan[] {
  const output: PackageFuriganaSpan[] = [];
  for (const span of spans) {
    const local = syllables[span.index]?.JapaneseReading?.furigana || [];
    for (const ruby of local) output.push({
      start: cp(text, span.start + ruby.start), end: cp(text, span.start + ruby.end), reading: ruby.reading, source: "provider",
    });
  }
  return output;
}

function authoredBoundaries(displayText: string, spans: PackageSourceSpan[]): BoundaryEvidence[] {
  const chars = Array.from(displayText);
  const boundaries: BoundaryEvidence[] = [];
  for (let index = 1; index < spans.length; index += 1) {
    const previous = spans[index - 1];
    const current = spans[index];
    if (current.start <= previous.end) continue;
    const gap = chars.slice(previous.end, current.start).join("");
    if (/^\s+$/u.test(gap)) {
      boundaries.push({
        offset: current.start,
        kind: "authored-whitespace",
        strength: "hard",
        sourceId: current.ownerId,
      });
    }
  }
  return boundaries;
}

export function furiganaContainedByTimingSpan(
  displayText: string,
  timingSpan: Pick<JapaneseTimedTextSpan, "start" | "end">,
  furigana: PackageFuriganaSpan[]
): Array<{ start: number; end: number; reading: string }> {
  const sourceStartCp = cp(displayText, timingSpan.start); const sourceEndCp = cp(displayText, timingSpan.end);
  return furigana.filter((item) => item.start >= sourceStartCp && item.end <= sourceEndCp).map((item) => ({
    start: utf16(displayText, item.start) - timingSpan.start,
    end: utf16(displayText, item.end) - timingSpan.start,
    reading: item.reading,
  }));
}

export async function processJapanesePackageLine(
  displayText: string,
  syllables: JapaneseReadable[],
  spans: JapaneseTimedTextSpan[],
  times: Array<{ StartTime?: number; EndTime?: number }>
): Promise<{ plan: RenderPlan; romaji: string }> {
  const { tokenizer, jmdict } = await loadDependencies();
  const sourceSpans: PackageSourceSpan[] = spans.map((span) => ({
    start: cp(displayText, span.start), end: cp(displayText, span.end), text: span.rawText, ownerId: String(span.index),
    beginMs: Number(times[span.index]?.StartTime || 0), endMs: Number(times[span.index]?.EndTime || 0),
  }));
  const result = await processJapaneseLine({
    displayText,
    spans: sourceSpans,
    providerFurigana: providerFurigana(displayText, syllables, spans),
    boundaries: authoredBoundaries(displayText, sourceSpans),
  }, { tokenizer, jmdict });
  if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error")) throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
  for (const span of spans) {
    // Ruby is semantic token geometry. A timing fragment may bisect it, but must
    // never receive a clipped range paired with the original full reading.
    const ruby = furiganaContainedByTimingSpan(displayText, span, result.furigana);
    syllables[span.index].JapaneseReading = { sourceText: syllables[span.index].Text || "", romaji: result.timedReadingUnits.find((unit) => unit.ownerId === String(span.index))?.romaji || "", furigana: ruby };
  }
  const timedReadingUnits = result.timedReadingUnits.map((unit, index) => ({
    spanId: unit.ownerId, canonicalRange: { startCp: unit.start, endCp: unit.end }, text: unit.romaji,
    logicalGroupId: result.layoutGroups.findIndex((group) => group.end > unit.start && group.start < unit.end) >= 0 ? `jp-${result.layoutGroups.findIndex((group) => group.end > unit.start && group.start < unit.end)}` : `jp-${index}`,
  }));
  const readingUnits = timedReadingUnits.map((unit) => ({ canonicalRange: unit.canonicalRange, text: unit.text, kind: "transformed" as const, logicalGroupId: unit.logicalGroupId, timingRefs: [unit.spanId] }));
  return {
    romaji: result.romaji,
    plan: { lineId: `japanese-package-${times[0]?.StartTime || 0}`, sourceUnits: sourceSpans.map((span) => ({ spanId: span.ownerId!, canonicalRange: { startCp: span.start, endCp: span.end } })), readingUnits, timedReadingUnits, joinedDisplayText: result.romaji, furigana: result.furigana },
  };
}

export async function processJapanesePackageTextTarget(target: JapaneseReadable & { Text?: string }): Promise<string | undefined> {
  const text = target.Text || "";
  if (!text) return undefined;
  const { tokenizer, jmdict } = await loadDependencies();
  const provider = (target.JapaneseReading?.furigana || []).map((ruby) => ({ start: cp(text, ruby.start), end: cp(text, ruby.end), reading: ruby.reading, source: "provider" as const }));
  const result = await processJapaneseLine({ displayText: text, providerFurigana: provider }, { tokenizer, jmdict });
  target.JapaneseReading = { sourceText: text, romaji: result.romaji, furigana: result.furigana.map((ruby) => ({ start: utf16(text, ruby.start), end: utf16(text, ruby.end), reading: ruby.reading })) };
  target.ReadingRenderPlan = {
    lineId: "japanese-package-line", sourceUnits: [{ spanId: "line", canonicalRange: { startCp: 0, endCp: Array.from(text).length } }],
    readingUnits: [{ canonicalRange: { startCp: 0, endCp: Array.from(text).length }, text: result.romaji, kind: "transformed", logicalGroupId: "jp-line", timingRefs: ["line"] }],
    timedReadingUnits: [{ spanId: "line", canonicalRange: { startCp: 0, endCp: Array.from(text).length }, text: result.romaji, logicalGroupId: "jp-line" }],
    joinedDisplayText: result.romaji, furigana: result.furigana,
  };
  target.RomanizedText = result.romaji; target.TransliteratedText = result.romaji;
  return result.romaji;
}
