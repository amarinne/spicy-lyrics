/**
 * Syllable Synchronization
 * 
 * Maps full-line romaji to individual syllables for karaoke-style
 * per-character highlighting. Uses kuromoji tokens for accurate
 * position mapping and handles Japanese phonetic merging rules.
 * 
 * @fork-feature Per-syllable karaoke sync
 */

import Kuroshiro from "kuroshiro";
import * as KuromojiAnalyzer from "../KuromojiAnalyzer.ts";
import { JUKUJIKUN } from "./JukujikuDict.ts";

/**
 * Maps romaji to individual syllables using Kuroshiro's full-line output,
 * kuromoji tokens for position mapping, compound reading corrections,
 * and Japanese phonetic merging rules (っ doubling, long vowels).
 * 
 * @param lineText - Original Japanese text
 * @param fullSpacedRomaji - Kuroshiro's spaced romaji output
 * @param syllables - Array of syllable objects to populate with RomanizedText
 * @param romajiPromise - Promise that resolves when Kuroshiro is initialized
 */
export async function mapRomajiToJapaneseSyllables(
  lineText: string,
  fullSpacedRomaji: string,
  syllables: any[],
  romajiPromise: Promise<void>
): Promise<void> {
  await romajiPromise;

  const tokens = await KuromojiAnalyzer.parse(lineText);
  const KUtil = (Kuroshiro as any).Util;
  const spacedParts = fullSpacedRomaji.split(/\s+/).filter((s: string) => s.length > 0);
  const useKuroshiro = spacedParts.length === tokens.length;

  // Build per-token entries with character positions
  interface Entry { start: number; end: number; romaji: string; consumed: boolean; }
  const entries: Entry[] = [];
  let charPos = 0;
  for (let ti = 0; ti < tokens.length; ti++) {
    const sf: string = tokens[ti].surface_form;
    let romaji: string;
    if (useKuroshiro) {
      romaji = spacedParts[ti];
    } else {
      const pron: string = tokens[ti].pronunciation || tokens[ti].reading || "";
      romaji = (pron && pron !== "*" && KUtil.hasKana(pron)) ? KUtil.kanaToRomaji(pron) : sf;
    }
    entries.push({ start: charPos, end: charPos + sf.length, romaji, consumed: false });
    charPos += sf.length;
  }

  // Pass 1: Compound readings (jukujikun) — check consecutive token surfaces
  for (let i = 0; i < tokens.length; i++) {
    if (entries[i].consumed) continue;
    for (let len = Math.min(4, tokens.length - i); len >= 2; len--) {
      const combined = tokens.slice(i, i + len).map((t: any) => t.surface_form).join("");
      if (JUKUJIKUN[combined]) {
        entries[i].romaji = JUKUJIKUN[combined];
        entries[i].end = entries[i + len - 1].end;
        for (let j = 1; j < len; j++) entries[i + j].consumed = true;
        break;
      }
    }
    // Also check single-token jukujikun
    if (!entries[i].consumed && JUKUJIKUN[tokens[i].surface_form]) {
      entries[i].romaji = JUKUJIKUN[tokens[i].surface_form];
    }
  }

  // Pass 2: Determine which token boundaries should have NO space
  const noSpaceBefore: boolean[] = new Array(tokens.length).fill(false);
  for (let i = 1; i < tokens.length; i++) {
    if (entries[i].consumed) { noSpaceBefore[i] = true; continue; }

    // Find previous non-consumed token
    let pi = i - 1;
    while (pi >= 0 && entries[pi].consumed) pi--;
    if (pi < 0) continue;

    const prevPron = tokens[pi].pronunciation || tokens[pi].reading || "";
    const currSf = tokens[i].surface_form;
    const currPron = tokens[i].pronunciation || tokens[i].reading || "";

    // っ/ッ at end of previous token → merge (doubles next consonant)
    if (prevPron.endsWith("ッ") || prevPron.endsWith("っ") ||
        tokens[pi].surface_form.endsWith("っ") || tokens[pi].surface_form.endsWith("ッ")) {
      noSpaceBefore[i] = true;
    }

    // う extending previous o-row sound (long vowel: しょう→shou, おう→ou)
    if ((currSf === "う" || currPron === "ウ") && prevPron) {
      const last = prevPron[prevPron.length - 1];
      if ("オコソトノホモヨロヲゴゾドボポョウクスツヌフムユルグズヅブプュ".includes(last)) {
        noSpaceBefore[i] = true;
      }
    }

    // い extending previous e-row sound (long vowel: きれい→kirei)
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

  // Map entries to syllables by character position
  let syllPos = 0;
  let prevLastIdx = -1;

  for (let si = 0; si < syllables.length; si++) {
    const syllable = syllables[si];
    const syllStart = syllPos;
    const syllEnd = syllPos + syllable.Text.length;
    syllPos = syllEnd;

    const parts: string[] = [];
    let firstIdx = -1;
    let lastIdx = -1;

    for (let ei = 0; ei < entries.length; ei++) {
      if (entries[ei].consumed) continue;
      if (entries[ei].start >= syllStart && entries[ei].start < syllEnd) {
        // Insert space between tokens within the same syllable, unless merged
        if (parts.length > 0 && !noSpaceBefore[ei]) {
          parts.push(" ");
        }
        parts.push(entries[ei].romaji);
        if (firstIdx === -1) firstIdx = ei;
        lastIdx = ei;
      }
    }

    // Add RomajiSpaceBefore if this syllable starts a new (non-merged) token
    if (si > 0 && firstIdx !== -1 && firstIdx !== prevLastIdx && !noSpaceBefore[firstIdx]) {
      syllable.RomajiSpaceBefore = true;
    }

    if (lastIdx !== -1) prevLastIdx = lastIdx;
    syllable.RomanizedText = parts.length > 0 ? parts.join("") : undefined;
  }
}
