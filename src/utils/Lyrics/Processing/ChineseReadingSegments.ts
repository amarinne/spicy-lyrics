/**
 * Builds readings that attach to the characters they read, for both Chinese modes.
 *
 * The grouping rule comes from mobile, which has shipped the attached-reading mode for a long time:
 * a reading belongs to whatever produced it, and display never regroups the plan. One span in,
 * one reading out; several spans only when the provider already owns them as a group. Anything that
 * cannot be expressed against existing spans is dropped rather than reshaped, so a plan's timing
 * ownership survives every placement setting.
 *
 * Mandarin and Cantonese differ in where groups come from, and both are correct:
 *   - Pinyin maps one syllable to one character, so tokens are per character.
 *   - Jyutping has multi-character dictionary phrases whose reading is a single string, so those
 *     arrive as genuine groups and cannot be split.
 */

import { pinyin } from "pinyin-pro";
import { buildMandarinWordLayout, walkCantoneseReadings } from "../Fork/Romanization.ts";
import type { AttachedReadingSegment, CanonicalSpanMapping, TextRange } from "./Model.ts";

type RangedReading = {
  readonly canonicalRange: TextRange;
  readonly reading: string;
};

function rangedMandarinReadings(text: string, tones: boolean): RangedReading[] {
  const layout = buildMandarinWordLayout(text);
  if (!layout.tokens.length) return [];

  // Deliberately the same call `romanizeMandarin` makes, so the reading a character gets does not
  // depend on where it is placed.
  const readings = pinyin(text, {
    type: "array",
    toneType: tones ? "symbol" : "none",
    toneSandhi: false,
    nonZh: "consecutive",
  }) as string[];

  // The same alignment `joinMandarinReadingWords` requires. A mismatch means the reading array and
  // the token walk disagree about the text, and a misaligned reading is worse than none.
  if (readings.length !== layout.tokenCount) return [];

  return layout.tokens.flatMap((token, index) => {
    const reading = (readings[index] ?? "").trim();
    if (!token.isHan || !reading || reading === token.text) return [];
    return [{ canonicalRange: { startCp: token.startCp, endCp: token.endCp }, reading }];
  });
}

function rangedCantoneseReadings(text: string, tones: boolean): RangedReading[] {
  const readings: RangedReading[] = [];
  for (const piece of walkCantoneseReadings(text, tones)) {
    const reading = piece.reading.trim();
    if (!piece.isHan || !reading || reading === piece.text) continue;
    readings.push({
      canonicalRange: { startCp: piece.startCp, endCp: piece.endCp },
      reading,
    });
  }
  return readings;
}

/**
 * Names the spans a reading covers. A reading that starts or ends mid-span is dropped: honouring it
 * would mean either splitting a span's timing or widening the reading past the characters it reads.
 */
function spanIdsForRange(
  range: TextRange,
  spanMappings: readonly CanonicalSpanMapping[],
): string[] | undefined {
  const covered = spanMappings.filter((mapping) =>
    mapping.canonicalRange.startCp < range.endCp && mapping.canonicalRange.endCp > range.startCp
  );
  if (!covered.length) return undefined;

  const first = covered[0].canonicalRange;
  const last = covered[covered.length - 1].canonicalRange;
  if (first.startCp < range.startCp || last.endCp > range.endCp) return undefined;

  return covered.map((mapping) => mapping.spanId);
}

export function buildChineseAttachedReadings(
  text: string,
  translitMode: "pinyin" | "jyutping",
  tones: boolean,
  spanMappings: readonly CanonicalSpanMapping[],
): AttachedReadingSegment[] {
  if (!text.trim() || !spanMappings.length) return [];

  const kind = translitMode === "jyutping" ? "cantoneseJyutping" : "mandarinPinyin";
  const ranged = translitMode === "jyutping"
    ? rangedCantoneseReadings(text, tones)
    : rangedMandarinReadings(text, tones);

  return ranged.flatMap((entry) => {
    const spanIds = spanIdsForRange(entry.canonicalRange, spanMappings);
    if (!spanIds) return [];
    return [{
      canonicalRange: entry.canonicalRange,
      spanIds,
      reading: entry.reading,
      kind,
      provenance: "local" as const,
    }];
  });
}
