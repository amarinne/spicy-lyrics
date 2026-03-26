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
import { applyJukujikun, computeNoSpaceBefore, type MergeableEntry } from "./JukujikunMerge.ts";

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
  interface Entry extends MergeableEntry { start: number; end: number; }
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

  // Apply jukujikun compounds, then extend end positions for syllable mapping
  applyJukujikun(entries, tokens);
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].consumed) continue;
    for (let j = i + 1; j < entries.length && entries[j].consumed; j++) {
      entries[i].end = entries[j].end;
    }
  }
  const noSpaceBefore = computeNoSpaceBefore(entries, tokens);

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
