/**
 * Per-syllable readings for a syllable-timed Mandarin line, taken from the line-level reading.
 *
 * The line display is romanized with the whole line, so Mandarin eza式 spells the surface tones
 * (sandhi, neutral pitch, tone 4 before tone 4) and pinyin-pro picks phrase readings. Romanizing each
 * timed syllable alone gives citation tones and context-free readings, so its chunks no longer appear in
 * the line display and the plan could not be carved from it. Each timed syllable takes the line's own
 * syllables for its characters instead, so every unit shows the same spelling as the line display.
 */

import { pinyin } from "pinyin-pro";
import { mandarinAnalysisText, mandarinEzaReadings } from "../Fork/MandarinEzaLine.ts";
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
  let startCp = 0;
  const items = pinyin(mandarinAnalysisText(lineText), {
    type: "all",
    toneType: tones ? "symbol" : "none",
    toneSandhi: false,
    nonZh: "consecutive",
  });
  for (const item of items) {
    if (item.isZh) out.set(startCp, item.pinyin);
    startCp += Array.from(item.origin).length;
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
): (string | undefined)[] | undefined {
  if (translitMode !== "pinyin" && translitMode !== "pinyin-vn") return undefined;
  if (syllableTexts.join("") !== lineText || KANA.test(lineText)) return undefined;
  const readings = lineHanReadings(lineText, translitMode === "pinyin-vn", tones);
  let offset = 0;
  return syllableTexts.map((text) => {
    const points = Array.from(text);
    const start = offset;
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
