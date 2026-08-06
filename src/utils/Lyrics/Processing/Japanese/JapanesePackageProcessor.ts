import {
  loadBrowserJmdictFurigana,
  loadBrowserJmdictPreferredReadings,
  loadBrowserUniDicTokenizer,
  processJapaneseLine,
  type BoundaryEvidence,
  type FuriganaSpan as PackageFuriganaSpan,
  type SourceSpan as PackageSourceSpan,
} from "japanese-lyrics-processor";
import type { JapaneseReadable, JapaneseTimedTextSpan } from "../../Reading/JapaneseReading.ts";
import type { RenderPlan } from "../Model.ts";

// preferredReadings is required for ja.reading.policy.preferred-lexical-reading. Without it the
// rule silently never fires and 玩具 stays がんぐ instead of the reviewed おもちゃ.
let dependencies: Promise<{
  tokenizer: Awaited<ReturnType<typeof loadBrowserUniDicTokenizer>>;
  jmdict: Awaited<ReturnType<typeof loadBrowserJmdictFurigana>>;
  preferredReadings: Awaited<ReturnType<typeof loadBrowserJmdictPreferredReadings>>;
}> | undefined;
/**
 * In Spotify the dictionaries are fetched once and cached in IndexedDB rather
 * than bundled, because embedding them costs ~66MB in a build with no code
 * splitting (see AssetCache.ts, and the stub wired up in spice.config.ts).
 *
 * Under Node's test runner there is no IndexedDB, so the loaders fall back to
 * japanese-lyrics-processor's embedded assets — those are stubbed out of the
 * esbuild bundle only, so tests keep exercising the real dictionaries offline.
 *
 * AssetCache is imported lazily because it opens IndexedDB at module scope,
 * which would break importing this module outside a browser.
 */
const assetSources = async (): Promise<{ unidic: object; jmdict: object }> => {
  if (typeof indexedDB === "undefined") return { unidic: {}, jmdict: {} };
  const { japaneseAssetLoader } = await import("./AssetCache.ts");
  return {
    unidic: { loadAsset: japaneseAssetLoader("unidic") },
    jmdict: { loadAsset: japaneseAssetLoader() },
  };
};

const loadDependencies = () => dependencies ??= assetSources()
  .then(({ unidic, jmdict }) => Promise.all([
    loadBrowserUniDicTokenizer(unidic),
    loadBrowserJmdictFurigana(jmdict),
    loadBrowserJmdictPreferredReadings(jmdict),
  ]))
  .then(([tokenizer, jmdict, preferredReadings]) => ({ tokenizer, jmdict, preferredReadings }));
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

export function timingSpanMergeRanges(
  displayText: string,
  spans: JapaneseTimedTextSpan[],
  furigana: PackageFuriganaSpan[]
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const ruby of furigana) {
    const rubyStart = utf16(displayText, ruby.start);
    const rubyEnd = utf16(displayText, ruby.end);
    const crossed = spans.filter((span) => ruby.end > cp(displayText, span.start) && ruby.start < cp(displayText, span.end));
    if (crossed.length < 2) continue;
    const first = spans.indexOf(crossed[0]);
    const last = spans.indexOf(crossed.at(-1)!);
    if (rubyStart < spans[first].end && rubyEnd > spans[last].start) ranges.push({ start: first, end: last });
  }
  ranges.sort((left, right) => left.start - right.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (!previous || range.start > previous.end) merged.push({ ...range });
    else previous.end = Math.max(previous.end, range.end);
  }
  return merged;
}

function coalesceTimedWords(
  displayText: string,
  syllables: JapaneseReadable[],
  spans: JapaneseTimedTextSpan[],
  times: Array<{ StartTime?: number; EndTime?: number }>,
  furigana: PackageFuriganaSpan[]
): JapaneseTimedTextSpan[] {
  const ranges = timingSpanMergeRanges(displayText, spans, furigana);
  if (!ranges.length) return spans;
  const mergedSyllables: JapaneseReadable[] = [];
  const mergedTimes: Array<{ StartTime?: number; EndTime?: number }> = [];
  const mergedSpans: JapaneseTimedTextSpan[] = [];
  let rangeIndex = 0;
  for (let index = 0; index < spans.length;) {
    const range = ranges[rangeIndex];
    const mergesRange = range?.start === index;
    const end = mergesRange ? range!.end : index;
    const firstSpan = spans[index];
    const lastSpan = spans[end];
    const firstSyllable = syllables[firstSpan.index] as JapaneseReadable & Record<string, unknown>;
    const text = displayText.slice(firstSpan.start, lastSpan.end);
    const nextIndex = mergedSyllables.length;
    mergedSyllables.push({ ...firstSyllable, Text: text } as JapaneseReadable);
    mergedTimes.push({ StartTime: times[firstSpan.index]?.StartTime, EndTime: times[lastSpan.index]?.EndTime });
    mergedSpans.push({ index: nextIndex, start: firstSpan.start, end: lastSpan.end, rawText: text });
    index = end + 1;
    if (mergesRange) rangeIndex += 1;
  }
  syllables.splice(0, syllables.length, ...mergedSyllables);
  if (times !== syllables) times.splice(0, times.length, ...mergedTimes);
  else {
    for (let index = 0; index < syllables.length; index += 1) Object.assign(syllables[index]!, mergedTimes[index]);
  }
  return mergedSpans;
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
  const { tokenizer, jmdict, preferredReadings } = await loadDependencies();
  const sourceSpans: PackageSourceSpan[] = spans.map((span) => ({
    start: cp(displayText, span.start), end: cp(displayText, span.end), text: span.rawText, ownerId: String(span.index),
    beginMs: Number(times[span.index]?.StartTime || 0), endMs: Number(times[span.index]?.EndTime || 0),
  }));
  const result = await processJapaneseLine({
    displayText,
    spans: sourceSpans,
    providerFurigana: providerFurigana(displayText, syllables, spans),
    boundaries: authoredBoundaries(displayText, sourceSpans),
  }, { tokenizer, jmdict, preferredReadings });
  if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error")) throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
  const displaySpans = coalesceTimedWords(displayText, syllables, spans, times, result.furigana);
  const spanRanges = displaySpans.map((span) => ({
    start: cp(displayText, span.start),
    end: cp(displayText, span.end),
  }));
  const romajiBySpan = displaySpans.map(() => [] as string[]);
  for (const unit of result.readingUnits) {
    let owner = -1;
    let ownerOverlap = 0;
    for (let index = 0; index < spanRanges.length; index += 1) {
      const range = spanRanges[index];
      const overlap = Math.max(0, Math.min(unit.end, range.end) - Math.max(unit.start, range.start));
      if (overlap > ownerOverlap) {
        owner = index;
        ownerOverlap = overlap;
      }
    }
    if (owner >= 0 && unit.romaji) romajiBySpan[owner].push(unit.romaji);
  }
  for (const span of displaySpans) {
    // Ruby is semantic token geometry. A timing fragment may bisect it, but must
    // never receive a clipped range paired with the original full reading.
    const ruby = furiganaContainedByTimingSpan(displayText, span, result.furigana);
    const spanIndex = displaySpans.indexOf(span);
    const romaji = romajiBySpan[spanIndex].join("");
    syllables[span.index].JapaneseReading = { sourceText: syllables[span.index].Text || "", romaji, furigana: ruby };
  }
  const timedReadingUnits = displaySpans.map((span, index) => {
    const startCp = cp(displayText, span.start);
    const endCp = cp(displayText, span.end);
    const groupIndex = result.layoutGroups.findIndex((group) => group.end > startCp && group.start < endCp);
    return {
      spanId: String(span.index), canonicalRange: { startCp, endCp },
      text: syllables[span.index].JapaneseReading?.romaji || "",
      logicalGroupId: groupIndex >= 0 ? `jp-${groupIndex}` : `jp-${index}`,
    };
  });
  const readingUnits = timedReadingUnits.map((unit) => ({ canonicalRange: unit.canonicalRange, text: unit.text, kind: "transformed" as const, logicalGroupId: unit.logicalGroupId, timingRefs: [unit.spanId] }));
  return {
    romaji: result.romaji,
    plan: { lineId: `japanese-package-${times[0]?.StartTime || 0}`, sourceUnits: displaySpans.map((span) => ({ spanId: String(span.index), canonicalRange: { startCp: cp(displayText, span.start), endCp: cp(displayText, span.end) } })), readingUnits, timedReadingUnits, joinedDisplayText: result.romaji, furigana: result.furigana },
  };
}

export async function processJapanesePackageTextTarget(target: JapaneseReadable & { Text?: string }): Promise<string | undefined> {
  const text = target.Text || "";
  if (!text) return undefined;
  const { tokenizer, jmdict, preferredReadings } = await loadDependencies();
  const provider = (target.JapaneseReading?.furigana || []).map((ruby) => ({ start: cp(text, ruby.start), end: cp(text, ruby.end), reading: ruby.reading, source: "provider" as const }));
  const result = await processJapaneseLine({ displayText: text, providerFurigana: provider }, { tokenizer, jmdict, preferredReadings });
  target.JapaneseReading = { sourceText: text, romaji: result.romaji, furigana: result.furigana.map((ruby) => ({ start: utf16(text, ruby.start), end: utf16(text, ruby.end), reading: ruby.reading })) };
  target.ReadingRenderPlan = {
    lineId: "japanese-package-line", sourceUnits: [{ spanId: "line", canonicalRange: { startCp: 0, endCp: Array.from(text).length } }],
    readingUnits: [{ canonicalRange: { startCp: 0, endCp: Array.from(text).length }, text: result.romaji, kind: "transformed", logicalGroupId: "jp-line", timingRefs: ["line"] }],
    timedReadingUnits: [{ spanId: "line", canonicalRange: { startCp: 0, endCp: Array.from(text).length }, text: result.romaji, logicalGroupId: "jp-line" }],
    joinedDisplayText: result.romaji, furigana: result.furigana,
  };
  return result.romaji;
}
