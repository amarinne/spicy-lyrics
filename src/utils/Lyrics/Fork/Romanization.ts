/**
 * Romanization Functions
 * 
 * Custom romanization implementations for various writing systems.
 * Extends upstream's basic romanization with:
 * - Cantonese Jyutping support
 * - Improved Cyrillic BGN/PCGN transliteration
 * - Fallback romaji builder for Japanese
 * 
 * @fork-feature Extended romanization support
 */

import type Kuroshiro from "kuroshiro";
import transliterPkg from "transliter";
import { getJyutpingList } from "to-jyutping";
import { hasUnromanizedKanji, ChineseTextTest } from "./TextDetection.ts";
import { analyzeJapaneseLine } from "../Reading/JapaneseReading.ts";

const JYUTPING_PHRASES: Record<string, string> = {
  上堂: "soeng5 tong4",
  終於: "zung1 jyu1",
  講到: "gong2 dou3",
  分數: "fan1 sou3",
  好學生: "hou2 hok6 saang1",
  好學: "hou3 hok6",
  學生: "hok6 saang1",
  老世: "lou5 sai3",
  要求: "jiu1 kau4",
  等陣: "dang2 zan6",
  開會: "hoi1 wui2",
  剩低: "zing6 dai1",
  搞掂: "gaau2 dim6",
  嘅嘢: "ge3 je5",
  㗎喇: "gaa3 laa3",
  香港: "hoeng1 gong2",
  廣東話: "gwong2 dung1 waa2",
  冇問題: "mou5 man6 tai4",
  唔知道: "m4 zi1 dou3",
  鍾意: "zung1 ji3",
  點解: "dim2 gaai2",
  今日: "gam1 jat6",
  聽日: "ting1 jat6",
  琴日: "kam4 jat6",
  乜嘢: "mat1 je5",
  係咪: "hai6 mai6",
  唔係: "m4 hai6",
  可以: "ho2 ji5",
  如果: "jyu4 gwo2",
  因為: "jan1 wai6",
  所以: "so2 ji5",
  一齊: "jat1 cai4",
  返嚟: "faan1 lai4",
  出去: "ceot1 heoi3",
  入嚟: "jap6 lai4",
  屋企: "uk1 kei2",
  自己: "zi6 gei2",
  大家: "daai6 gaa1",
  我哋: "ngo5 dei6",
  你哋: "nei5 dei6",
  佢哋: "keoi5 dei6",
};

const JYUTPING_PHRASE_KEYS = Object.keys(JYUTPING_PHRASES).sort((a, b) => b.length - a.length);

// ─── Cantonese (Jyutping) ─────────────────────────────────────────────────────

/**
 * Romanize Chinese text using Cantonese Jyutping.
 * Uses the to-jyutping library for character-by-character conversion.
 */
export async function romanizeCantonese(
  text: string,
  primaryLanguage: string,
  skipTextTests: boolean
): Promise<string | undefined> {
  if (primaryLanguage !== "cmn" && primaryLanguage !== "yue" && !skipTextTests && !ChineseTextTest.test(text)) {
    return undefined;
  }

  const parts: string[] = [];
  for (let index = 0; index < text.length;) {
    const phrase = JYUTPING_PHRASE_KEYS.find((key) => text.startsWith(key, index));
    if (phrase) {
      parts.push(JYUTPING_PHRASES[phrase]);
      index += phrase.length;
      continue;
    }

    const char = Array.from(text.slice(index))[0];
    const list = getJyutpingList(char);
    const reading = list?.[0]?.[1] || char;
    if (reading.trim()) parts.push(reading);
    index += char.length;
  }

  return parts.join(" ").replace(/\s+/g, " ").trim() || undefined;
}

// ─── Cyrillic (BGN/PCGN) ──────────────────────────────────────────────────────

export type CyrillicMode = "Russian" | "Ukrainian";

function ukrainianLetter(char: string): string | undefined {
  switch (char) {
    case "г": return "h";
    case "Г": return "H";
    case "ґ": return "g";
    case "Ґ": return "G";
    case "и": return "y";
    case "И": return "Y";
    case "і": return "i";
    case "І": return "I";
    case "ї": return "yi";
    case "Ї": return "Yi";
    case "є": return "ye";
    case "Є": return "Ye";
    default: return undefined;
  }
}

function isCyrillicSource(char: string): boolean {
  const cp = char.codePointAt(0) ?? 0;
  return (cp >= 0x0400 && cp <= 0x04FF) || (cp >= 0x0500 && cp <= 0x052F);
}

function isRussianYeTrigger(char: string | null): boolean {
  return char == null || /[аеёиоуыэюяйъьАЕЁИОУЫЭЮЯЙЪЬ]/.test(char);
}

function normalizeCyrillicAscii(value: string): string {
  return value
    .replace(/Ë/g, "Yo").replace(/ë/g, "yo")
    .replace(/ǵ/g, "g").replace(/Ǵ/g, "G")
    .replace(/ḱ/g, "k").replace(/Ḱ/g, "K")
    .replace(/ẑ/g, "dz").replace(/Ẑ/g, "Dz")
    .replace(/ì/g, "i").replace(/đ/g, "dj").replace(/Đ/g, "Dj")
    .replace(/ć/g, "c").replace(/Ć/g, "C")
    .replace(/ž/g, "zh").replace(/Ž/g, "Zh")
    .replace(/dž/g, "dzh").replace(/Dž/g, "Dzh");
}

function mapCyrillic(char: string, prevCyrillic: string | null, mode: CyrillicMode, keepSigns: boolean): string {
  if (char === "ъ" || char === "Ъ") return keepSigns ? "ʺ" : "";
  if (char === "ь" || char === "Ь") return keepSigns ? "ʹ" : "";

  if (mode === "Ukrainian") {
    const mapped = ukrainianLetter(char);
    if (mapped) return mapped;
    if (char === "е") return "e";
    if (char === "Е") return "E";
  } else {
    if (char === "е") return isRussianYeTrigger(prevCyrillic) ? "ye" : "e";
    if (char === "Е") return isRussianYeTrigger(prevCyrillic) ? "Ye" : "E";
  }

  return normalizeCyrillicAscii(transliterPkg.transliter(char, "bgn-pcgn") ?? char);
}

/**
 * Romanize Cyrillic text with Russian BGN/PCGN defaults plus Android-port
 * options for Ukrainian letter values and hard/soft sign preservation.
 */
export function romanizeCyrillic(
  text: string,
  mode: CyrillicMode = "Russian",
  keepSigns: boolean = false
): string {
  let result = "";
  let prevCyrillic: string | null = null;
  for (const char of text) {
    if (isCyrillicSource(char)) {
      result += mapCyrillic(char, prevCyrillic, mode, keepSigns);
      prevCyrillic = char;
    } else {
      if (/\s/.test(char)) prevCyrillic = null;
      result += char;
    }
  }
  return result;
}

// ─── Korean (spelling + pronunciation) ────────────────────────────────────────

export type KoreanMode = "spelling" | "pronunciation";

const HANGUL_INITIAL = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const HANGUL_VOWEL = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
const HANGUL_FINAL = ["", "k", "k", "ks", "n", "nj", "nh", "t", "l", "lk", "lm", "lb", "ls", "lt", "lp", "lh", "m", "p", "ps", "t", "t", "ng", "t", "t", "k", "t", "p", "t"];

const ONSET = HANGUL_INITIAL;
const VOWEL = HANGUL_VOWEL;
const CODA_ROMAN: Record<number, string> = { 0: "", 1: "k", 4: "n", 7: "t", 8: "l", 16: "m", 17: "p", 21: "ng" };

const NUC_I = 20;
const CODA_NONE = 0;
const CODA_G = 1;
const CODA_N = 4;
const CODA_D = 7;
const CODA_L = 8;
const CODA_M = 16;
const CODA_B = 17;
const CODA_NG = 21;
const CODA_H = 27;
const ON_G = 0;
const ON_N = 2;
const ON_D = 3;
const ON_R = 5;
const ON_M = 6;
const ON_B = 7;
const ON_S = 9;
const ON_SS = 10;
const ON_NULL = 11;
const ON_J = 12;
const ON_CH = 14;
const ON_K = 15;
const ON_T = 16;
const ON_P = 17;
const ON_H = 18;

type HangulSyllable = [number, number, number];

function decomposeHangul(char: string): HangulSyllable | null {
  const cp = char.codePointAt(0) ?? 0;
  if (cp < 0xAC00 || cp > 0xD7A3) return null;
  const s = cp - 0xAC00;
  return [Math.floor(s / 588), Math.floor((s % 588) / 28), s % 28];
}

function romanizeKoreanSpelling(text: string): string {
  let out = "";
  for (const char of text) {
    const syl = decomposeHangul(char);
    out += syl ? HANGUL_INITIAL[syl[0]] + HANGUL_VOWEL[syl[1]] + HANGUL_FINAL[syl[2]] : char;
  }
  return out;
}

function liaisonSplit(coda: number): [number, number] {
  switch (coda) {
    case 1: return [CODA_NONE, ON_G];
    case 2: return [CODA_NONE, 1];
    case 3: return [CODA_G, ON_S];
    case 4: return [CODA_NONE, ON_N];
    case 5: return [CODA_N, ON_J];
    case 6: return [CODA_NONE, ON_N];
    case 7: return [CODA_NONE, ON_D];
    case 8: return [CODA_NONE, ON_R];
    case 9: return [CODA_L, ON_G];
    case 10: return [CODA_L, ON_M];
    case 11: return [CODA_L, ON_B];
    case 12: return [CODA_L, ON_S];
    case 13: return [CODA_L, ON_T];
    case 14: return [CODA_L, ON_P];
    case 15: return [CODA_NONE, ON_R];
    case 16: return [CODA_NONE, ON_M];
    case 17: return [CODA_NONE, ON_B];
    case 18: return [CODA_B, ON_S];
    case 19: return [CODA_NONE, ON_S];
    case 20: return [CODA_NONE, ON_SS];
    case 21: return [CODA_NG, ON_NULL];
    case 22: return [CODA_NONE, ON_J];
    case 23: return [CODA_NONE, ON_CH];
    case 24: return [CODA_NONE, ON_K];
    case 25: return [CODA_NONE, ON_T];
    case 26: return [CODA_NONE, ON_P];
    default: return [CODA_NONE, ON_NULL];
  }
}

function codaRepresentative(coda: number): number {
  if ([1, 2, 9, 24].includes(coda)) return CODA_G;
  if ([4, 5, 6].includes(coda)) return CODA_N;
  if ([7, 19, 20, 22, 23, 25, 27].includes(coda)) return CODA_D;
  if ([8, 11, 12, 13, 15].includes(coda)) return CODA_L;
  if ([10, 16].includes(coda)) return CODA_M;
  if ([14, 17, 18, 26].includes(coda)) return CODA_B;
  if (coda === 21) return CODA_NG;
  return CODA_NONE;
}

function nasalizeStop(rep: number): number {
  if (rep === CODA_G) return CODA_NG;
  if (rep === CODA_D) return CODA_N;
  if (rep === CODA_B) return CODA_M;
  return rep;
}

function applyKoreanPronunciationRules(run: HangulSyllable[]): void {
  for (let i = 0; i + 1 < run.length; i += 1) {
    const cur = run[i];
    const next = run[i + 1];
    let coda = cur[2];
    const onset = next[0];
    const nucleus = next[1];
    if (coda === CODA_NONE) continue;

    if (onset === ON_NULL) {
      if (coda === CODA_H) {
        cur[2] = CODA_NONE;
        continue;
      }
      const [left, movedOnset] = liaisonSplit(coda);
      let moved = movedOnset;
      if (nucleus === NUC_I && moved === ON_D) moved = ON_J;
      else if (nucleus === NUC_I && moved === ON_T) moved = ON_CH;
      cur[2] = left;
      next[0] = moved;
      continue;
    }

    let rep = codaRepresentative(coda);
    if (coda === CODA_H) {
      if (onset === ON_G) { next[0] = ON_K; cur[2] = CODA_NONE; continue; }
      if (onset === ON_D) { next[0] = ON_T; cur[2] = CODA_NONE; continue; }
      if (onset === ON_B) { next[0] = ON_P; cur[2] = CODA_NONE; continue; }
      if (onset === ON_J) { next[0] = ON_CH; cur[2] = CODA_NONE; continue; }
      if (onset === ON_S) { next[0] = ON_SS; cur[2] = CODA_NONE; continue; }
      rep = CODA_D;
    } else if (onset === ON_H) {
      if (rep === CODA_G) { next[0] = ON_K; cur[2] = CODA_NONE; continue; }
      if (rep === CODA_D) { next[0] = ON_T; cur[2] = CODA_NONE; continue; }
      if (rep === CODA_B) { next[0] = ON_P; cur[2] = CODA_NONE; continue; }
    }

    cur[2] = rep;
    if (onset === ON_N || onset === ON_M) cur[2] = nasalizeStop(rep);
    if (onset === ON_R) {
      if (cur[2] === CODA_N || cur[2] === CODA_L) {
        cur[2] = CODA_L;
      } else {
        next[0] = ON_N;
        cur[2] = nasalizeStop(cur[2]);
      }
    } else if (cur[2] === CODA_L && onset === ON_N) {
      next[0] = ON_R;
    }
  }
}

function flushKoreanRun(run: HangulSyllable[]): string {
  if (run.length === 0) return "";
  applyKoreanPronunciationRules(run);
  let out = "";
  let prevCoda = CODA_NONE;
  for (const syl of run) {
    const onset = syl[0] === ON_R && prevCoda === CODA_L ? "l" : ONSET[syl[0]];
    out += onset + VOWEL[syl[1]] + (CODA_ROMAN[syl[2]] ?? "");
    prevCoda = syl[2];
  }
  run.length = 0;
  return out;
}

function romanizeKoreanPronunciation(text: string): string {
  let out = "";
  const run: HangulSyllable[] = [];
  for (const char of text) {
    const syl = decomposeHangul(char);
    if (syl) {
      run.push(syl);
    } else {
      out += flushKoreanRun(run);
      out += char;
    }
  }
  return out + flushKoreanRun(run);
}

export function romanizeKorean(text: string, mode: KoreanMode = "spelling"): string {
  return mode === "pronunciation" ? romanizeKoreanPronunciation(text) : romanizeKoreanSpelling(text);
}

// ─── Japanese Romaji Fallback ─────────────────────────────────────────────────

/**
 * Build complete romaji from kuromoji tokens with JUKUJIKUN overrides.
 * This is the robust fallback when kuroshiro fails to convert certain kanji.
 * 
 * @param text - Japanese text to romanize
 * @returns Spaced romaji string, or null if tokenization fails
 */
export async function buildRomajiFromTokens(text: string): Promise<string | null> {
  return (await analyzeJapaneseLine(text))?.romaji || null;
}

/**
 * Try kuroshiro conversion first, fall back to token-based if kanji remain.
 * 
 * @param text - Japanese text to romanize
 * @param romajiConverter - Initialized Kuroshiro instance
 * @returns Spaced romaji string
 */
export async function romanizeJapaneseWithFallback(
  text: string,
  romajiConverter: Kuroshiro
): Promise<string> {
  let result = await romajiConverter.convert(text, {
    to: "romaji",
    mode: "spaced",
  });

  // Fallback: if kuroshiro still left kanji un-romanized, rebuild from kuromoji tokens
  if (hasUnromanizedKanji(result)) {
    const rebuilt = await buildRomajiFromTokens(text);
    if (rebuilt) {
      result = rebuilt;
    }
  }

  return result;
}
