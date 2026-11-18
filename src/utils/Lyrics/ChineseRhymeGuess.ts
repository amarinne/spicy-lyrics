import { pinyin } from "pinyin-pro";
import { getJyutpingList } from "to-jyutping";
import type { ChineseLanguage } from "./ChineseTranslitMode.ts";

export const CHINESE_RHYME_REVISION = "tone-rhyme-v4";
/**
 * Cantonese-only function characters. Each is close to absent from written Mandarin, so a song
 * that uses two different ones is Cantonese however its line endings rhyme. Counting distinct
 * characters stops one repeated word from deciding a track. Ambiguous characters that also occur
 * in Mandarin (晒/曬, 郁, 咩, 畀/俾) are deliberately excluded.
 */
const CANTONESE_MARKERS = new Set("嘅咗啲冇唔佢喺嘢嚟睇乜嗰哋搵啱攞諗瞓噉咁啩喎囉嗮冚揸嘥攰".split(""));
const CANTONESE_MARKER_THRESHOLD = 2;
/**
 * Chance that two unrelated line endings share a rhyme key, per reading. Mandarin collapses the
 * Middle Chinese finals into 13 buckets while Jyutping keeps 49, so counting raw "exclusive" pairs
 * compares inventories of very different size and inflates the Mandarin side roughly 2x: a pair of
 * lines collides by accident 10.5% of the time under Mandarin and 5.08% under Jyutping. Re-measured
 * over the 177-document Cantonese/Mandarin corpus. Re-measure if the finals tables change.
 */
const MANDARIN_CHANCE_COLLISION = 0.105;
const JYUTPING_CHANCE_COLLISION = 0.0508;
/**
 * Fitted on the 177-song corpus in docs/private/rhyme-limits (v4 refit, standardized logistic,
 * C=10). Tone parallelism and rhyme z are independent signals: the rhyme wins songs that end lines
 * alike, the tone contour wins songs whose lines follow the melody regardless of their endings.
 * Confidence comes from the logistic distance, not from either signal alone, so a single weak clue
 * cannot decide a track.
 */
const DECISION_WEIGHTS = { rhymeZ: 0.613, toneExcess: 29.35, markers: 3.03, bias: -5.87 };
const DECISION_HIGH = 0.9;
const DECISION_LOW = 0.1;
/** Below this many usable lines the corpus accuracy falls off a cliff (80% at 6 lines, 89% at 12). */
const MIN_DECISION_LINES = 12;
/**
 * 0243-style pitch classes: tone 4 lowest, 6 low-mid, 3/5 mid, 1/2 high. Cantopop melodies carry
 * the Cantonese tone through the sung pitch, so lines that share a melody share this contour.
 */
const JP_TONE_CLASS: Record<string, number> = { "4": 0, "6": 1, "3": 2, "5": 2, "1": 3, "2": 3 };
const TONE_MIN_LINE_LENGTH = 5;
// CJK Unified Ideographs plus the Compatibility Ideographs block, which starts at U+F900.
// Spelling the lower bound as 豈 would start at U+8C48 and count Hangul as Han.
const HAN = /[\u3400-\u9fff\uf900-\ufaff]/gu;
const MANDARIN_RHYMES: Record<string, string> = {
  ie: "e", üe: "e", o: "e", uo: "o", ong: "eng", iong: "eng", ing: "eng",
  in: "en", un: "en", ün: "en", ui: "ei", iu: "ou", ü: "i",
};

export type ChineseRhymeGuess = {
  language?: ChineseLanguage;
  lineCount: number;
  cantoneseOnlyPairs: number;
  mandarinOnlyPairs: number;
  cantoneseMarkers: number;
  /** Rhyme evidence for each reading, in standard deviations above chance collisions. */
  jyutpingZ?: number;
  mandarinZ?: number;
  /** Tone-contour parallelism of the Jyutping reading over its reversed-line baseline. */
  toneExcess?: number;
  /** Fitted Cantonese probability behind the decision. */
  probability?: number;
};

/** Timestamps, credit lines, repeated choruses and one-character lines carry no evidence. */
function cleanLines(lines: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const raw of lines) {
    const line = raw.replace(/\[[^\]]*\]/gu, "").trim();
    if (!line || /[:：]/u.test(line) || (line.match(HAN)?.length ?? 0) < 2) continue;
    unique.add(line);
  }
  return [...unique];
}

/** Positions whose characters differ agree only if both readings carry a tone class there. */
function toneAgreement(tones: number[], partner: number[], han: string, partnerHan: string): number {
  let matches = 0;
  let compared = 0;
  for (let index = 0; index < tones.length; index++) {
    if (han[index] === partnerHan[index] || tones[index] < 0 || partner[index] < 0) continue;
    compared++;
    if (tones[index] === partner[index]) matches++;
  }
  return compared >= 3 ? matches / compared : 0;
}

function sameCharacterRatio(han: string, partnerHan: string): number {
  if (!han.length) return 1;
  let same = 0;
  for (let index = 0; index < han.length; index++) if (han[index] === partnerHan[index]) same++;
  return same / han.length;
}

function toneClasses(han: string): number[] {
  return getJyutpingList(han).map(([, reading]) => (reading ? JP_TONE_CLASS[reading.slice(-1)] ?? -1 : -1));
}

/**
 * Mean best-partner tone agreement among same-length lines, minus the score of the same partner
 * read backwards. Every line is compared against all lines of its own length, so the result does
 * not depend on which line pairs the lyricist actually rhymed; the reversed partner keeps the tone
 * frequencies but destroys the positional contour.
 */
function toneExcessOf(cleaned: readonly string[]): number {
  const toneLines = cleaned.map((line) => {
    const han = (line.match(HAN) ?? []).join("");
    return { han, tones: toneClasses(han) };
  });
  const groups = new Map<number, typeof toneLines>();
  for (const line of toneLines) {
    if (line.han.length < TONE_MIN_LINE_LENGTH) continue;
    const group = groups.get(line.han.length);
    if (group) group.push(line);
    else groups.set(line.han.length, [line]);
  }
  let sum = 0;
  let baseline = 0;
  let counted = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const line of group) {
      let best = 0;
      let reversed = 0;
      for (const partner of group) {
        if (partner === line || sameCharacterRatio(line.han, partner.han) > 0.6) continue;
        best = Math.max(best, toneAgreement(line.tones, partner.tones, line.han, partner.han));
        reversed = Math.max(reversed, toneAgreement(
          line.tones,
          [...partner.tones].reverse(),
          line.han,
          [...partner.han].reverse().join(""),
        ));
      }
      sum += best;
      baseline += reversed;
      counted++;
    }
  }
  return counted ? (sum - baseline) / counted : 0;
}

/** Tone-contour parallelism of a raw lyric document; higher means the melody tracks Cantonese tones. */
export function toneParallelism(lines: readonly string[]): number {
  return toneExcessOf(cleanLines(lines));
}

/**
 * Song-only clue: repeated lines and rhymes explained by both readings provide no extra evidence.
 * Markers decide first because they are lexical rather than statistical; everything else comes from
 * rhyme evidence measured against each reading's own collision rate plus tone-melody parallelism.
 */
export function guessChineseFromRhymes(lines: readonly string[]): ChineseRhymeGuess {
  const accepted = cleanLines(lines);
  const cantoneseMarkers = new Set<string>();
  for (const char of accepted.join("")) if (CANTONESE_MARKERS.has(char)) cantoneseMarkers.add(char);
  const endings = accepted.map((line) => line.match(HAN)!.at(-1)!);
  const keys = endings.map((char) => {
    const final = pinyin(char, { pattern: "final", toneType: "none", type: "array" })[0]
      ?.replace(/v/gu, "ü").replace(/^[iuü](?=[aeoê])/u, "");
    const jyutping = getJyutpingList(char)[0]?.[1]?.split(" ")[0]?.replace(/\d$/u, "");
    const jyutFinal = jyutping?.replace(/^(gw|kw|ng|[bpmfdtnlgkhzcsjw])/u, "") || jyutping;
    // Cantopop rhymes by group, not by exact final: -aan/-aam and -am/-an rhyme, and yu before a
    // coda reads as i (yun = in, yut = it). Keep -ng and -k apart; merging them made
    // 反方向的鐘 a false Cantonese result.
    const jyutGroup = jyutFinal?.replace(/[mn]$/u, "N").replace(/[pt]$/u, "T").replace(/^yu(?=[NT])/u, "i");
    return { pinyin: final ? MANDARIN_RHYMES[final] ?? final : undefined, jyutping: jyutGroup };
  });
  let cantoneseOnlyPairs = 0;
  let mandarinOnlyPairs = 0;
  let rhymePairs = 0;
  let sharedJyutpingPairs = 0;
  let sharedMandarinPairs = 0;
  for (const distance of [1, 2]) {
    for (let i = 0; i + distance < keys.length; i++) {
      const a = keys[i], b = keys[i + distance];
      if (!a.pinyin || !b.pinyin || !a.jyutping || !b.jyutping) continue;
      rhymePairs++;
      const canto = a.jyutping === b.jyutping;
      const mando = a.pinyin === b.pinyin;
      if (canto) sharedJyutpingPairs++;
      if (mando) sharedMandarinPairs++;
      if (canto && !mando) cantoneseOnlyPairs++;
      if (mando && !canto) mandarinOnlyPairs++;
    }
  }
  const zScore = (observed: number, chance: number) => {
    const expected = rhymePairs * chance;
    return expected > 0 ? (observed - expected) / Math.sqrt(expected * (1 - chance)) : 0;
  };
  const jyutpingZ = zScore(sharedJyutpingPairs, JYUTPING_CHANCE_COLLISION);
  const mandarinZ = zScore(sharedMandarinPairs, MANDARIN_CHANCE_COLLISION);
  const markerCount = cantoneseMarkers.size;
  const toneExcess = toneExcessOf(accepted);
  const logit = DECISION_WEIGHTS.rhymeZ * (jyutpingZ - mandarinZ)
    + DECISION_WEIGHTS.toneExcess * toneExcess
    + DECISION_WEIGHTS.markers * Math.min(markerCount, 3)
    + DECISION_WEIGHTS.bias;
  const probability = 1 / (1 + Math.exp(-logit));
  const language = markerCount >= CANTONESE_MARKER_THRESHOLD
    ? "yue"
    : accepted.length < MIN_DECISION_LINES
      ? undefined
      : probability > DECISION_HIGH
        ? "yue"
        : probability < DECISION_LOW ? "cmn" : undefined;
  return {
    language,
    lineCount: endings.length,
    cantoneseOnlyPairs,
    mandarinOnlyPairs,
    cantoneseMarkers: markerCount,
    jyutpingZ,
    mandarinZ,
    toneExcess,
    probability,
  };
}
