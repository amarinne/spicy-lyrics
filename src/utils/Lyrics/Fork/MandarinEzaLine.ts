/** Whole-line model readings with jieba grouping for the frozen sandhi layer. */
import { mandarinEzaSurfaceSyllables, type MandarinEzaToken } from "./MandarinEzaSandhi.ts";
import { ensureMandarinReader, readMandarinLine } from "./MandarinReader.ts";

type Jieba = {
  cut(text: string, hmm?: boolean): string[];
  cut_for_search(text: string, hmm?: boolean): string[];
  tag(text: string, hmm?: boolean): { word: string; tag: string }[];
};
let jieba: Jieba | undefined;
let loading: Promise<boolean> | undefined;

/** Load the local model, dictionaries and segmenter once, before either Mandarin display path. */
export function ensureMandarinSegmenter(): Promise<boolean> {
  loading ??= (async () => {
    const [, segmented] = await Promise.all([ensureMandarinReader(), (async () => {
      try {
        const module: any = await import("jieba-wasm");
        if (typeof module.default === "function") {
          const { default: bytes } = await import("jieba-wasm-bytes");
          await module.default({ module_or_path: bytes });
        }
        const api: Jieba = typeof module.cut === "function" ? module : module.default;
        if (typeof api?.cut !== "function") return false;
        jieba = api;
        return true;
      } catch (error) {
        console.warn("[spicy-lyrics] Mandarin segmenter unavailable; using character feet", error);
        return false;
      }
    })()]);
    return segmented;
  })();
  return loading;
}

const HAN = /^\p{Script=Han}+$/u;
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

/** Grouping never chooses readings. Without jieba, each Han code point forms a foot. */
export function mandarinWordGroups(text: string): string[] {
  const groups = jieba?.cut(text, true).flatMap(splitKinds);
  return groups?.join("") === text ? groups : splitKinds(text).flatMap((run) => HAN.test(run) ? Array.from(run) : [run]);
}

function hanTokens(text: string): MandarinEzaToken[] {
  const tags = new Map<string, string>();
  const tagged = jieba?.tag(text, true);
  if (tagged?.map((item) => item.word).join("") === text) {
    let start = 0;
    for (const item of tagged) {
      const end = start + Array.from(item.word).length;
      tags.set(`${start}:${end}`, item.tag);
      start = end;
    }
  }
  const tokens: MandarinEzaToken[] = [];
  let position = 0;
  for (const surface of mandarinWordGroups(text)) {
    const start = position;
    position += Array.from(surface).length;
    if (!HAN.test(surface)) continue;
    const searchPieces = jieba && position - start >= 3
      ? jieba.cut_for_search(surface, true).filter((piece) => piece !== surface && piece.length > 0)
      : [];
    const pos = tags.get(`${start}:${position}`);
    tokens.push({ surface, start, ...(searchPieces.length ? { searchPieces } : {}), ...(pos ? { pos } : {}) });
  }
  return tokens;
}

export type MandarinEzaReading = {
  readonly origin: string;
  readonly isZh: boolean;
  readonly startCp: number;
  /** Selected lexical reading, including neutral 5. A full-tone alternative never replaces it. */
  readonly citation: string;
  readonly surface: string;
};

let previousSource: string | undefined;
let previousReadings: MandarinEzaReading[] | undefined;

/** One reading per Han code point; consecutive non-Han text stays intact. */
export function mandarinEzaReadings(source: string): MandarinEzaReading[] {
  if (source === previousSource && previousReadings) return previousReadings;
  const line = readMandarinLine(source);
  const points = Array.from(source);
  if (line.syllables.length !== points.length || line.syllables.some((item, index) =>
    item.index !== index || item.char !== points[index]
    || (item.status === "reading" && !/^[a-züê]+[1-5]$/u.test(item.raw)))) {
    throw new Error("Mandarin reader violated its code-point reading contract");
  }
  const citation = line.syllables.map((item) => item.status === "reading" ? item.raw : undefined);
  const surface = mandarinEzaSurfaceSyllables(citation, hanTokens(source));
  const items: MandarinEzaReading[] = [];
  for (const item of line.syllables) {
    const isZh = item.status === "reading";
    const last = items.at(-1);
    if (item.status === "passthrough" && last && !last.isZh && !/\p{Script=Han}/u.test(last.origin)) {
      items[items.length - 1] = { ...last, origin: last.origin + item.char };
    } else {
      items.push({ origin: item.char, isZh, startCp: item.index,
        citation: isZh ? item.raw : "", surface: isZh ? surface[item.index] ?? item.raw : "" });
    }
  }
  previousSource = source;
  previousReadings = items;
  return items;
}
