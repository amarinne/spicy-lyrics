/**
 * Per-syllable readings for a syllable-timed Mandarin line, taken from the line-level reading.
 *
 * The line display is romanized with the whole line, so Mandarin eza式 spells the surface tones
 * (sandhi, neutral pitch, tone 4 before tone 4) and the reader chooses contextual readings. Romanizing each
 * timed syllable alone gives citation tones and context-free readings, so its chunks no longer appear in
 * the line display and the plan could not be carved from it. Each timed syllable takes the line's own
 * syllables for its characters instead, so every unit shows the same spelling as the line display.
 *
 * Authored Bopomofo resolves against the line first. A provider chunk that cuts a Bopomofo syllable
 * gets `null`: the chunk that owns the syllable start carries its whole reading, the continuation
 * carries no display text, and both share a logical group. The plan therefore keeps one visible
 * owner per authored syllable and never emits a fragment such as `ㄧ` -> `yi`.
 */

import { mandarinEzaReadings } from "../Fork/MandarinEzaLine.ts";
import { formatPinyin } from "../Fork/MandarinPinyinFormat.ts";
import { scanZhuyinRuns } from "../Fork/MandarinZhuyin.ts";
import { pinyin } from "pinyin-pro";
import { convertMandarinSyllableToVnAid } from "../Fork/MandarinVnAid.ts";

const HAN = /\p{Script=Han}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;

type AuthoredSyllable = Readonly<{ startCp: number; endCp: number; reading: string }>;

function codePointIndex(text: string, utf16Offset: number): number {
  return Array.from(text.slice(0, utf16Offset)).length;
}

function authoredSyllables(lineText: string, vnAid: boolean, tones: boolean): AuthoredSyllable[] {
  const out: AuthoredSyllable[] = [];
  for (const run of scanZhuyinRuns(lineText)) {
    if (!run.valid) continue;
    let startCp = codePointIndex(lineText, run.start);
    for (const syllable of run.syllables) {
      const length = Array.from(syllable.source).length;
      out.push({
        startCp,
        endCp: startCp + length,
        reading: vnAid
          ? convertMandarinSyllableToVnAid(syllable.pinyin, tones)
          : formatPinyin(syllable.pinyin, tones ? "diacritics" : "unmarked"),
      });
      startCp += length;
    }
  }
  return out;
}

function addPlainSegment(segment: string, startCp: number, out: Map<number, string>, tones: boolean): number {
  if (!segment) return startCp;
  let cursor = startCp;
  for (const item of pinyin(segment, { type: "all", toneType: tones ? "symbol" : "none", toneSandhi: false, nonZh: "consecutive" })) {
    if (item.isZh) out.set(cursor, item.result);
    cursor += Array.from(item.origin).length;
  }
  return cursor;
}

/** The line's reading of each code point that is a Han character, spelled as the line display spells it. */
function lineHanReadings(lineText: string, vnAid: boolean, tones: boolean): Map<number, string> {
  const out = new Map<number, string>();
  if (vnAid) {
    for (const item of mandarinEzaReadings(lineText)) {
      if (item.isZh && !item.zhuyin) out.set(item.startCp, convertMandarinSyllableToVnAid(item.surface, tones));
    }
    return out;
  }
  const runs = scanZhuyinRuns(lineText);
  if (!runs.length) {
    let offset = 0;
    for (const item of pinyin(lineText, { type: "all", toneType: tones ? "symbol" : "none", toneSandhi: false, nonZh: "consecutive" })) {
      if (item.isZh) out.set(offset, item.result);
      offset += Array.from(item.origin).length;
    }
    return out;
  }
  // Authored candidate runs own their code points. Skip them so a rejected run never leaks a Han
  // 一 alias into the package reading.
  let cursor = 0;
  let cp = 0;
  for (const run of runs) {
    if (run.start > cursor) cp = addPlainSegment(lineText.slice(cursor, run.start), cp, out, tones);
    cp += Array.from(run.source).length;
    cursor = run.end;
  }
  if (cursor < lineText.length) addPlainSegment(lineText.slice(cursor), cp, out, tones);
  return out;
}

export type MandarinTimedChunkPlan = Readonly<{
  /** One entry per timed syllable; `null` marks a continuation of an earlier authored syllable. */
  chunks: readonly (string | null | undefined)[];
  /** Shared group id for every provider span that belongs to the same displayed reading. */
  logicalGroupIds: readonly string[];
}>;

/**
 * One reading chunk per timed syllable, or undefined when the line cannot be mapped to its syllables
 * (the caller keeps the per-syllable readings it already has). A syllable with no readable text is
 * undefined and keeps its own text; a split authored syllable is `null` in its continuation chunks.
 */
export function mandarinTimedChunkPlan(
  lineText: string,
  syllableTexts: readonly string[],
  translitMode: "pinyin" | "jyutping" | "pinyin-vn" | "jyutping-vn",
  tones: boolean,
  sourceRanges?: readonly { startCp: number; endCp: number }[],
): MandarinTimedChunkPlan | undefined {
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

  const vnAid = translitMode === "pinyin-vn";
  const readings = lineHanReadings(lineText, vnAid, tones);
  const authored = authoredSyllables(lineText, vnAid, tones);
  const authoredAt = new Map<number, AuthoredSyllable>();
  for (const syllable of authored) {
    for (let cp = syllable.startCp; cp < syllable.endCp; cp += 1) authoredAt.set(cp, syllable);
  }
  const owners = new Map<AuthoredSyllable, number>();
  if (sourceRanges) {
    for (const syllable of authored) {
      const owner = sourceRanges.findIndex((range) => range.startCp <= syllable.startCp && syllable.startCp < range.endCp);
      if (owner >= 0) owners.set(syllable, owner);
    }
  }

  let offset = 0;
  const chunks: (string | null | undefined)[] = syllableTexts.map((text, index) => {
    const range = sourceRanges?.[index];
    const points = range ? linePoints.slice(range.startCp, range.endCp) : Array.from(text);
    const start = range?.startCp ?? offset;
    offset += points.length;
    const overlapsAuthored = points.some((_, at) => authoredAt.has(start + at));
    if (!overlapsAuthored) {
      if (!HAN.test(text)) return undefined;
      const items: string[] = [];
      let other = "";
      points.forEach((point, at) => {
        const reading = readings.get(start + at);
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
    }

    const items: string[] = [];
    let other = "";
    let owned = 0;
    let nonAuthoredReadings = 0;
    points.forEach((point, at) => {
      const cp = start + at;
      const syllable = authoredAt.get(cp);
      if (syllable) {
        if (cp === syllable.startCp && cp >= start && cp < start + points.length) {
          if (other) items.push(other);
          other = "";
          items.push(syllable.reading);
          owned += 1;
        }
        return;
      }
      const reading = readings.get(cp);
      if (reading === undefined) {
        other += point;
        return;
      }
      if (other) items.push(other);
      other = "";
      items.push(reading);
      nonAuthoredReadings += 1;
    });
    if (owned === 0 && nonAuthoredReadings === 0) return null;
    if (other) items.push(other);
    return items.join(" ").replace(/\s+/gu, " ").trim();
  });

  const logicalGroupIds = syllableTexts.map((_, index) => {
    const range = sourceRanges?.[index];
    if (!range) return `generic-${index}`;
    const owned = authored.find((syllable) => syllable.startCp >= range.startCp && syllable.startCp < range.endCp);
    if (owned) return `zhuyin-${index}`;
    const continuing = authored.find((syllable) => syllable.startCp < range.startCp && syllable.endCp > range.startCp);
    const owner = continuing ? owners.get(continuing) : undefined;
    return owner === undefined ? `generic-${index}` : `zhuyin-${owner}`;
  });

  return { chunks, logicalGroupIds };
}

export function mandarinTimedChunks(
  lineText: string,
  syllableTexts: readonly string[],
  translitMode: "pinyin" | "jyutping" | "pinyin-vn" | "jyutping-vn",
  tones: boolean,
  sourceRanges?: readonly { startCp: number; endCp: number }[],
): (string | null | undefined)[] | undefined {
  return mandarinTimedChunkPlan(lineText, syllableTexts, translitMode, tones, sourceRanges)?.chunks;
}
