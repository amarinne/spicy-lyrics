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
import Kuroshiro from "kuroshiro";
import { getJyutpingList } from "to-jyutping";
import * as KuromojiAnalyzer from "../KuromojiAnalyzer.ts";
import { JUKUJIKUN } from "./JukujikuDict.ts";
import { hasUnromanizedKanji, ChineseTextTest } from "./TextDetection.ts";

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
  const KUtil = (Kuroshiro as any).Util;
  const tokens = await KuromojiAnalyzer.parse(text);
  if (!tokens || tokens.length === 0) return null;

  // Build per-token romaji entries
  interface TokenEntry { romaji: string; consumed: boolean; }
  const entries: TokenEntry[] = tokens.map((t: any) => {
    const pron: string = t.pronunciation || t.reading || "";
    let romaji: string;
    if (pron && pron !== "*" && KUtil.hasKana(pron)) {
      romaji = KUtil.kanaToRomaji(pron);
    } else if (KUtil.hasKana(t.surface_form)) {
      romaji = KUtil.kanaToRomaji(t.surface_form);
    } else {
      // If no pronunciation available and surface is pure kanji, leave as-is (rare)
      romaji = t.surface_form;
    }
    return { romaji, consumed: false };
  });

  // Pass 1: Apply JUKUJIKUN compounds (check consecutive token surfaces)
  for (let i = 0; i < tokens.length; i++) {
    if (entries[i].consumed) continue;
    for (let len = Math.min(4, tokens.length - i); len >= 2; len--) {
      const combined = tokens.slice(i, i + len)
        .map((t: any) => t.surface_form).join("");
      if (JUKUJIKUN[combined]) {
        entries[i].romaji = JUKUJIKUN[combined];
        for (let j = 1; j < len; j++) entries[i + j].consumed = true;
        break;
      }
    }
    // Also check single-token jukujikun
    if (!entries[i].consumed && JUKUJIKUN[tokens[i].surface_form]) {
      entries[i].romaji = JUKUJIKUN[tokens[i].surface_form];
    }
  }

  // Pass 2: Determine which tokens should merge (no space before)
  const noSpaceBefore: boolean[] = new Array(tokens.length).fill(false);
  for (let i = 1; i < tokens.length; i++) {
    if (entries[i].consumed) { noSpaceBefore[i] = true; continue; }

    let pi = i - 1;
    while (pi >= 0 && entries[pi].consumed) pi--;
    if (pi < 0) continue;

    const prevSf = tokens[pi].surface_form;
    const prevPron = tokens[pi].pronunciation || tokens[pi].reading || "";
    const currSf = tokens[i].surface_form;
    const currPron = tokens[i].pronunciation || tokens[i].reading || "";

    // っ/ッ at end of previous token → merge
    if (prevPron.endsWith("ッ") || prevPron.endsWith("っ") ||
        prevSf.endsWith("っ") || prevSf.endsWith("ッ")) {
      noSpaceBefore[i] = true;
    }

    // う extending previous o-row sound (long vowel)
    if ((currSf === "う" || currPron === "ウ") && prevPron) {
      const last = prevPron[prevPron.length - 1];
      if ("オコソトノホモヨロヲゴゾドボポョウクスツヌフムユルグズヅブプュ".includes(last)) {
        noSpaceBefore[i] = true;
      }
    }

    // い extending previous e-row sound (long vowel)
    if ((currSf === "い" || currPron === "イ") && prevPron) {
      const last = prevPron[prevPron.length - 1];
      if ("エケセテネヘメレゲゼデベペェ".includes(last)) {
        noSpaceBefore[i] = true;
      }
    }

    // Punctuation — no space before
    if (/^[。、？！…・「」『』（）()\.\?\!,\s]+$/.test(currSf)) {
      noSpaceBefore[i] = true;
    }
  }

  // Build final romaji string
  const parts: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].consumed) continue;
    if (parts.length > 0 && !noSpaceBefore[i]) {
      parts.push(" ");
    }
    parts.push(entries[i].romaji);
  }

  return parts.join("").replace(/\s{2,}/g, " ").trim();
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
