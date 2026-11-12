/**
 * Mandarin eza式 line readings: citation Pinyin from pinyin-pro, word tokens from jieba, optional
 * dictionary neutral flags, then the surface tones of `MandarinEzaSandhi.ts`.
 *
 * Only the eza式 layer reads this. Standard Pinyin keeps the plain pinyin-pro citation reading.
 *
 * Segmenter: jieba-wasm 2.4.0, the same build the cjk-labs reference uses, so word tokens,
 * `cut_for_search` subwords and `tag` verbs match it. The wasm is bundled (see `spice.config.ts`):
 * no network call. It loads asynchronously; `ensureMandarinSegmenter` must resolve before a line is
 * read with jieba. Until then, or if it fails, pinyin-pro's own word segmentation stands in (no
 * subwords, no verb tags).
 */

import { OutputFormat, pinyin, segment } from "pinyin-pro";
import { mandarinEzaSurfaceSyllables, type MandarinEzaToken } from "./MandarinEzaSandhi.ts";

type Jieba = {
  cut(text: string, hmm?: boolean): string[];
  cut_for_search(text: string, hmm?: boolean): string[];
  tag(text: string, hmm?: boolean): { word: string; tag: string }[];
};

let jieba: Jieba | undefined;
let loading: Promise<boolean> | undefined;

/** Load the jieba segmenter once. Resolves false when it cannot load; readings then use the fallback. */
export function ensureMandarinSegmenter(): Promise<boolean> {
  loading ??= (async () => {
    try {
      const module: any = await import("jieba-wasm");
      // The browser build exports an async initializer; the Node build is ready on import.
      if (typeof module.default === "function") {
        const { default: bytes } = await import("jieba-wasm-bytes");
        await module.default({ module_or_path: bytes });
      }
      const api: Jieba = typeof module.cut === "function" ? module : module.default;
      if (typeof api?.cut !== "function") return false;
      jieba = api;
      return true;
    } catch (error) {
      console.warn("[spicy-lyrics] Mandarin segmenter unavailable; eza式 sandhi uses pinyin-pro words", error);
      return false;
    }
  })();
  return loading;
}

/**
 * Dictionary neutral flags (M1b), keyed `${word}|${letters}`: the word, then its toneless syllables
 * joined by spaces (`朋友|peng you`). The value lists the character positions the dictionary marks
 * neutral. Only the eza式 layer reads it. The data (built from CC-CEDICT by
 * `tools/generate-mandarin-neutral-words.mjs`) is not shipped; without it the provider's tones stand.
 */
export type MandarinNeutralWords = ReadonlyMap<string, readonly number[]>;
let neutralWords: MandarinNeutralWords | undefined;

export function setMandarinNeutralWords(words: MandarinNeutralWords | undefined): void {
  neutralWords = words;
}

/**
 * The text the readers analyse. 妳 is the feminine form of 你 and reads nǐ, but pinyin-pro reads it nǎi, so every
 * Mandarin reading path (Standard Pinyin and eza式) analyses it as 你. The replacement has the same length, so
 * code-point offsets still index the source line, and callers keep the source surface.
 */
export const mandarinAnalysisText = (text: string): string => text.replaceAll("妳", "你");

const HAN = /^\p{Script=Han}+$/u;
const toneless = (syllable: string) => syllable.replace(/[0-9]$/u, "");

/** Split a segmenter token into runs of one character class, as the reference does. */
function splitKinds(surface: string): string[] {
  const groups: string[] = [];
  let han: boolean | undefined;
  for (const point of surface) {
    const next = HAN.test(point);
    if (han === next) groups[groups.length - 1] += point;
    else groups.push(point);
    han = next;
  }
  return groups;
}

/** jieba tags keyed by code-point range, only when the tagger covers exactly the text. */
function tagByRange(api: Jieba, text: string): Map<string, string> {
  const tags = new Map<string, string>();
  const tagged = api.tag(text, true);
  if (tagged.map((item) => item.word).join("") !== text) return tags;
  let position = 0;
  for (const { word, tag } of tagged) {
    const end = position + Array.from(word).length;
    tags.set(`${position}:${end}`, tag);
    position = end;
  }
  return tags;
}

/** The Han word tokens of a line, or undefined when the segmenter output does not cover the text. */
function hanTokens(text: string): MandarinEzaToken[] | undefined {
  const api = jieba;
  const surfaces = api
    ? api.cut(text, true).flatMap(splitKinds)
    : (segment(text, { format: OutputFormat.ZhArray, nonZh: "consecutive", toneSandhi: false }) as string[][])
      .flatMap((group) => splitKinds(group.join("")));
  if (surfaces.join("") !== text) return undefined;
  const tags = api ? tagByRange(api, text) : new Map<string, string>();
  const tokens: MandarinEzaToken[] = [];
  let position = 0;
  for (const surface of surfaces) {
    const start = position;
    position += Array.from(surface).length;
    if (!HAN.test(surface)) continue;
    const searchPieces = api && position - start >= 3
      ? api.cut_for_search(surface, true).filter((piece) => piece !== surface && piece.length > 0)
      : [];
    const pos = tags.get(`${start}:${position}`);
    tokens.push({ surface, start, ...(searchPieces.length ? { searchPieces } : {}), ...(pos ? { pos } : {}) });
  }
  return tokens;
}

/** The token with its dictionary neutral positions, when the overlay knows the word with this reading. */
function withDictionaryNeutral(token: MandarinEzaToken, syllables: readonly (string | undefined)[]): MandarinEzaToken {
  const size = Array.from(token.surface).length;
  if (!neutralWords || size < 2) return token;
  const own = syllables.slice(token.start, token.start + size);
  if (own.some((syllable) => !syllable)) return token;
  const positions = neutralWords.get(`${token.surface}|${own.map((syllable) => toneless(syllable)).join(" ")}`);
  return positions?.length ? { ...token, dictionaryNeutral: positions } : token;
}

export type MandarinEzaReading = {
  readonly origin: string;
  readonly isZh: boolean;
  /** Code-point offset of `origin` in the line. */
  readonly startCp: number;
  /** pinyin-pro citation syllable (`hao3`), or "" for non-Chinese text. */
  readonly citation: string;
  /** Surface syllable for the eza式 layer (`hao2`, `de6`), or "" for non-Chinese text. */
  readonly surface: string;
};

/**
 * One reading per pinyin-pro item of the line: the same call and item order as the plain
 * Mandarin path, with the eza式 surface syllable beside the citation syllable.
 */
export function mandarinEzaReadings(source: string): MandarinEzaReading[] {
  const text = mandarinAnalysisText(source);
  const points = Array.from(source);
  const items = pinyin(text, { type: "all", toneType: "num", toneSandhi: false, nonZh: "consecutive" });
  const citation: (string | undefined)[] = [];
  for (const item of items) {
    const size = Array.from(item.origin).length;
    if (item.isZh && size === 1) citation.push(item.pinyin);
    else for (let index = 0; index < size; index++) citation.push(undefined);
  }
  const tokens = citation.length === Array.from(text).length ? hanTokens(text) : undefined;
  const surface = tokens
    ? mandarinEzaSurfaceSyllables(citation, tokens.map((token) => withDictionaryNeutral(token, citation)))
    : citation;
  let startCp = 0;
  return items.map((item) => {
    const reading = {
      origin: points.slice(startCp, startCp + Array.from(item.origin).length).join(""),
      isZh: item.isZh,
      startCp,
      citation: item.isZh ? item.pinyin : "",
      surface: item.isZh ? surface[startCp] ?? item.pinyin : "",
    };
    startCp += Array.from(item.origin).length;
    return reading;
  });
}
