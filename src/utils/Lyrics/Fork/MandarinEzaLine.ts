/**
 * Mandarin eza式 line: layer 1 from the g2pM reader, layer 2 sandhi, layer 3 tone transformation.
 * Policy `eza-2026-11-15.3`, matching the cjk-labs reference reader, `eza-sandhi.ts` and `eza.ts`.
 *
 * Layers 2 and 3 never choose a reading or change letters; layer 4 (`MandarinVnAid.ts`) spells.
 * Standard Pinyin keeps the plain package output and never runs these layers.
 */
import {
  ezaSurfaceReadings,
  type MandarinEzaReadingLine,
  type MandarinEzaSyllable,
  type MandarinEzaToken,
} from "./MandarinEzaSandhi.ts";
import { realizeSurfaceTones } from "./MandarinEzaTones.ts";
import { ensureMandarinReader, lookupMandarinPhrases, readMandarinLine, segmentMandarinLine } from "./MandarinReader.ts";

/** Load the shared model and portable jieba DAG+HMM segmenter before the eza式 display path. */
export async function ensureMandarinSegmenter(): Promise<boolean> {
  await ensureMandarinReader();
  return true;
}

/** The segmenter supplies feet and tags only. It never chooses a reading. */
export function mandarinWordGroups(text: string): string[] {
  return segmentMandarinLine(text).map((token) => token.text);
}

const SYLLABLE = /^[a-zü]+[1-5]$/u;
const toneOf = (syllable: string) => Number(syllable.at(-1));

/**
 * Layer 1: letters, the real tone and the N flag, never sandhi.
 * 一 is always `yi1` and 不 is always `bu4`; a neutral reading keeps its real tone when the data has one.
 * `alwaysNeutral` marks a word position whose whole-token phrase readings are all neutral (姐姐, 椅子, 耳朵).
 */
export function mandarinLayer1Line(source: string): MandarinEzaReadingLine {
  const evidence = readMandarinLine(source);
  const wordReadings = new Map<string, readonly (readonly string[])[]>();
  for (const match of lookupMandarinPhrases(source)) {
    if (match.range[1] - match.range[0] < 2) continue;
    const key = `${match.range[0]}:${match.range[1]}`;
    const rows = wordReadings.get(key) ?? [];
    wordReadings.set(key, [...rows, ...match.readings.map((reading) => reading.split(" "))]);
  }
  const tokens: MandarinEzaToken[] = segmentMandarinLine(source).map((token) => {
    if (token.kind !== "han") return { ...token, syllables: [] };
    const syllables = evidence.syllables.slice(token.range.start, token.range.end).map((item, at): MandarinEzaSyllable => {
      if (item.status !== "reading") return { status: "unavailable", reason: item.status === "unavailable" ? item.reason : "No Han reading." };
      const unsupported = [item.raw, ...item.candidates].filter((reading) => !SYLLABLE.test(reading));
      if (unsupported.length) return { status: "unavailable", reason: `Engine evidence contains unsupported eza Pinyin syllables: ${[...new Set(unsupported)].join(", ")}.` };
      const citation = item.citation.slice(0, -1) === item.raw.slice(0, -1) ? item.citation : item.raw;
      const char = Array.from(token.text)[at]!;
      const fixed = char === "一" ? { letters: "yi", tone: 1 as const, neutral: false }
        : char === "不" ? { letters: "bu", tone: 4 as const, neutral: false }
          : { letters: item.raw.slice(0, -1), tone: toneOf(citation) as 1 | 2 | 3 | 4 | 5, neutral: item.neutral };
      const readings = wordReadings.get(`${token.range.start}:${token.range.end}`) ?? (item.candidates.length ? [item.candidates] : [[item.raw]]);
      const alwaysNeutral = fixed.neutral && readings.length > 0
        && readings.every((reading) => reading[at] !== undefined && toneOf(reading[at]!) === 5);
      return {
        status: "available",
        ...fixed,
        ...(item.candidates.length > 1 ? { alternatives: item.candidates } : {}),
        ...(alwaysNeutral ? { alwaysNeutral: true as const } : {}),
      };
    });
    return { ...token, syllables };
  });
  return { text: source, tokens };
}

export type MandarinEzaReading = {
  readonly origin: string;
  readonly isZh: boolean;
  readonly startCp: number;
  /** Selected lexical reading, including neutral 5. A full-tone alternative never replaces it. */
  readonly citation: string;
  /** Surface reading after sandhi and the tone-4 transformation. */
  readonly surface: string;
};

let previousSource: string | undefined;
let previousReadings: MandarinEzaReading[] | undefined;

/** One reading per Han code point; consecutive non-Han text stays intact. */
export function mandarinEzaReadings(source: string): MandarinEzaReading[] {
  if (source === previousSource && previousReadings) return previousReadings;
  const line = mandarinLayer1Line(source);
  const realized = realizeSurfaceTones(ezaSurfaceReadings(line));
  const points = Array.from(source);
  const items: MandarinEzaReading[] = [];
  let cursor = 0;
  line.tokens.forEach((token, index) => {
    if (token.range.start !== cursor) throw new Error("Mandarin segmenter violated its code-point contract");
    cursor = token.range.end;
    const chars = Array.from(token.text);
    const own = realized[index];
    chars.forEach((char, at) => {
      const syllable = token.syllables[at];
      const isZh = syllable?.status === "available" && own?.[at] !== undefined;
      if (!isZh) {
        const last = items.at(-1);
        if (last && !last.isZh && !/\p{Script=Han}/u.test(last.origin)) items[items.length - 1] = { ...last, origin: last.origin + char };
        else items.push({ origin: char, isZh: false, startCp: token.range.start + at, citation: "", surface: "" });
        return;
      }
      items.push({ origin: char, isZh: true, startCp: token.range.start + at,
        citation: `${syllable.letters}${syllable.neutral ? 5 : syllable.tone}`, surface: own![at]! });
    });
  });
  if (cursor !== points.length) throw new Error("Mandarin reader violated its code-point reading contract");
  previousSource = source;
  previousReadings = items;
  return items;
}
