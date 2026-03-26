/**
 * Shared Jukujikun + Token Merge Logic
 *
 * Eliminates duplication between Romanization.ts and SyllableSync.ts
 * for compound kanji reading lookup and phonetic merge determination.
 */

import { JUKUJIKUN } from "./JukujikuDict.ts";

export interface MergeableEntry {
  romaji: string;
  consumed: boolean;
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
  return noSpaceBefore;
}
