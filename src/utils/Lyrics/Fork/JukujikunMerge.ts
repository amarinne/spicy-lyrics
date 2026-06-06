/**
 * Shared Jukujikun + Token Merge Logic
 *
 * Shared compound kanji reading lookup and phonetic merge rules.
 */

import { JUKUJIKUN } from "./JukujikuDict.ts";

export interface MergeableEntry {
  romaji: string;
  consumed: boolean;
}

const SMALL_TSU_ROMAJI = /(?:xtsu|ltsu|tsu)$/i;
const NUMBER_LIKE = /^(?:\d+|[一二三四五六七八九十百千万億兆何]+)$/;
const PLURAL_PRONOUN_BEFORE_KATA = /^(?:あなた|貴方|君|きみ|皆|みんな|僕|ぼく|私|わたし|我々)$/;
const DEMONSTRATIVE_BEFORE_KATA = /^(?:この|その|あの|どの)$/;

const doubledSokuon = (romaji: string): string => {
  if (!romaji) return romaji;
  const lower = romaji.toLowerCase();
  if (/^[aeioun]/.test(lower)) return romaji;
  return `${romaji[0]}${romaji}`;
};

/**
 * Apply phonetic mutations that need neighboring tokens.
 * Example: いたっ + て => ita + tte, not itatsu te.
 */
export function applyContextualReadingOverrides(
  entries: MergeableEntry[],
  tokens: any[]
): void {
  for (let i = 0; i < tokens.length; i++) {
    if (entries[i].consumed) continue;

    const sf = tokens[i].surface_form || "";
    const prevSf = tokens[i - 1]?.surface_form || "";
    const nextSf = tokens[i + 1]?.surface_form || "";

    if (sf === "私") {
      // Lyrics overwhelmingly use わたし; avoid kuromoji's formal わたくし drift.
      entries[i].romaji = "watashi";
      continue;
    }

    if (sf === "人") {
      // Counter suffix: 三 人 => san nin. Bare/word 人 in lyrics usually hito.
      entries[i].romaji = NUMBER_LIKE.test(prevSf) ? "nin" : "hito";
      continue;
    }

    if (sf === "方") {
      if (PLURAL_PRONOUN_BEFORE_KATA.test(prevSf)) {
        entries[i].romaji = "gata";
      } else if (DEMONSTRATIVE_BEFORE_KATA.test(prevSf)) {
        entries[i].romaji = "kata";
      } else if (prevSf === "の" || /^[へにをがはも]$/.test(nextSf)) {
        entries[i].romaji = "hou";
      }
      continue;
    }

    if (sf === "生") {
      // Bare 生 is too ambiguous (sei/shou/nama/i/u/ha). Only handle clear okurigana splits.
      if (/^[きくけ]$/.test(nextSf)) entries[i].romaji = "i";
      else if (/^[ま]$/.test(nextSf)) entries[i].romaji = "u";
      else if (/^[え]$/.test(nextSf)) entries[i].romaji = "ha";
    }
  }
}

export function applyPhoneticMerges(
  entries: MergeableEntry[],
  tokens: any[]
): void {
  for (let i = 1; i < tokens.length; i++) {
    if (entries[i].consumed) continue;

    let pi = i - 1;
    while (pi >= 0 && entries[pi].consumed) pi--;
    if (pi < 0) continue;

    const prevSf = tokens[pi].surface_form || "";
    const prevPron = tokens[pi].pronunciation || tokens[pi].reading || "";
    if (!(prevPron.endsWith("ッ") || prevPron.endsWith("っ") || prevSf.endsWith("っ") || prevSf.endsWith("ッ"))) {
      continue;
    }

    entries[pi].romaji = entries[pi].romaji.replace(SMALL_TSU_ROMAJI, "");
    entries[i].romaji = doubledSokuon(entries[i].romaji);
  }
}

/**
 * Pass 1: Apply JUKUJIKUN compound overrides to consecutive token entries.
 * Mutates entries in-place — marks consumed entries and replaces romaji.
 */
export function applyJukujikun(
  entries: MergeableEntry[],
  tokens: any[]
): void {
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
}

/**
 * Pass 2: Determine which tokens should merge (no space before).
 * Returns a boolean array where true means "merge with previous token".
 */
export function computeNoSpaceBefore(
  entries: MergeableEntry[],
  tokens: any[]
): boolean[] {
  const noSpaceBefore: boolean[] = Array.from({ length: tokens.length }, () => false);
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
    if (/^[。、？！…・「」『』（）().?!,\s]+$/.test(currSf)) {
      noSpaceBefore[i] = true;
    }
  }
  return noSpaceBefore;
}
