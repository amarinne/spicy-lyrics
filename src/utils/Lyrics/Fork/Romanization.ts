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

import transliterPkg from "transliter";
import type Kuroshiro from "kuroshiro";
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

/**
 * Romanize Cyrillic text using BGN/PCGN transliteration standard.
 * Includes post-processing to normalize diacritics to ASCII.
 */
export function romanizeCyrillic(text: string): string {
  const result = transliterPkg.transliter(text, "bgn-pcgn");
  if (result == null) return text;

  // Replace remaining diacritics with plain ASCII equivalents
  return result
    .replace(/[Ёё]/g, (c: string) => c === "Ё" ? "Yo" : "yo")  // pre-transliter missed ё
    .replace(/Ë/g, "Yo").replace(/ë/g, "yo")
    .replace(/['']/g, "")                                        // drop hard/soft sign markers
    .replace(/ǵ/g, "g").replace(/Ǵ/g, "G")
    .replace(/ḱ/g, "k").replace(/Ḱ/g, "K")
    .replace(/ẑ/g, "dz").replace(/Ẑ/g, "Dz")
    .replace(/ì/g, "i").replace(/đ/g, "dj").replace(/Đ/g, "Dj")
    .replace(/ć/g, "c").replace(/Ć/g, "C")
    .replace(/ž/g, "zh").replace(/Ž/g, "Zh");
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
