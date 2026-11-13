/**
 * Per-syllable readings for a syllable-timed Mandarin line, taken from the line-level reading.
 *
 * The line display is romanized with the whole line, so Mandarin eza式 spells the surface tones
 * (sandhi, neutral pitch, tone 4 before tone 4) and the reader chooses contextual readings. Romanizing each
 * timed syllable alone gives citation tones and context-free readings, so its chunks no longer appear in
 * the line display and the plan could not be carved from it. Each timed syllable takes the line's own
 * syllables for its characters instead, so every unit shows the same spelling as the line display.
 */

import { mandarinEzaReadings } from "../Fork/MandarinEzaLine.ts";
import { formatPinyin } from "../Fork/MandarinPinyinFormat.ts";
import { convertMandarinSyllableToVnAid } from "../Fork/MandarinVnAid.ts";

const HAN = /\p{Script=Han}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** The line's reading of each code point that is a Han character, spelled as the line display spells it. */
function lineHanReadings(lineText: string, vnAid: boolean, tones: boolean): Map<number, string> {
  const out = new Map<number, string>();
  if (vnAid) {
    for (const item of mandarinEzaReadings(lineText)) {
      if (item.isZh) out.set(item.startCp, convertMandarinSyllableToVnAid(item.surface, tones));
    }
    return out;
  }
  for (const item of mandarinEzaReadings(lineText)) {
    if (item.isZh) out.set(item.startCp, formatPinyin(item.citation, tones ? "diacritics" : "unmarked"));
  }
  return out;
}

/**
 * One reading chunk per timed syllable, or undefined when the line cannot be mapped to its syllables
 * (the caller keeps the per-syllable readings it already has). A syllable with no Han character is
 * undefined in the result and keeps its own text.
 */
export function mandarinTimedChunks(
  lineText: string,
  syllableTexts: readonly string[],
  translitMode: "pinyin" | "jyutping" | "pinyin-vn" | "jyutping-vn",
  tones: boolean,
  sourceRanges?: readonly { startCp: number; endCp: number }[],
): (string | undefined)[] | undefined {
  if (translitMode !== "pinyin" && translitMode !== "pinyin-vn") return undefined;
  if (KANA.test(lineText)) return undefined;
  const linePoints = Array.from(lineText);
  if (sourceRanges) {
    let previousEnd = 0;
    if (sourceRanges.length !== syllableTexts.length || sourceRanges.some((range, index) => {
      const invalid = !Number.isInteger(range.startCp) || !Number.isInteger(range.endCp)
        || range.startCp < previousEnd || range.endCp < range.startCp || range.endCp > linePoints.length
        || linePoints.slice(range.startCp, range.endCp).join("") !== syllableTexts[index].trim();
      previousEnd = range.endCp;
      return invalid;
    })) return undefined;
  } else if (syllableTexts.join("") !== lineText) return undefined;
  const readings = lineHanReadings(lineText, translitMode === "pinyin-vn", tones);
  let offset = 0;
  return syllableTexts.map((text, index) => {
    const range = sourceRanges?.[index];
    const points = range ? linePoints.slice(range.startCp, range.endCp) : Array.from(text);
    const start = range?.startCp ?? offset;
    offset += points.length;
    if (!HAN.test(text)) return undefined;
    // The same item layout as the line display: each Han character and each run of other text is one item.
    const items: string[] = [];
    let other = "";
    points.forEach((point, index) => {
      const reading = readings.get(start + index);
      if (reading === undefined) {
        other += point;
        return;
      }
      if (other) items.push(other);
      other = "";
      items.push(reading);
    });
    if (other) items.push(other);
    return items.join(" ").replace(/\s+/gu, " ").trim();
  });
}
