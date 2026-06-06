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
  if (primaryLanguage === "cmn" || primaryLanguage === "yue" || (!skipTextTests && ChineseTextTest.test(text))) {
    const list = getJyutpingList(text);
    if (list) {
      return list
        .map(([_char, reading]: [string, string | null]) => reading || _char)
        .filter((s: string) => s.trim().length > 0)
        .join(" ");
    }
  }
  return undefined;
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
