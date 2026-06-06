/**
 * Translation Module
 * 
 * Google Translate integration with localStorage caching.
 * Provides batch translation of lyrics lines with automatic
 * language detection and cache management.
 * 
 * @fork-feature Google Translate integration
 */

import { franc } from "franc-all";
import langs from "langs";
import { translationEnabled, translationTargetLang } from "../lyrics.ts";
import { isMeaningfullyDifferent } from "../TextCompare.ts";

// ─── Cache Configuration ──────────────────────────────────────────────────────

const TRANSLATION_CACHE_KEY = "spicy-lyrics:translationCache";
const TRANSLATION_CACHE_MAX_ENTRIES = 5000;

// In-memory mirror – loaded once from localStorage
let _translationCache: Record<string, string> | null = null;
let _cacheCount = -1; // lazy, -1 = unknown

// ─── Cache Management ─────────────────────────────────────────────────────────

function getTranslationCache(): Record<string, string> {
  if (_translationCache) return _translationCache;
  try {
    const raw = localStorage.getItem(TRANSLATION_CACHE_KEY);
    _translationCache = raw ? JSON.parse(raw) : {};
  } catch {
    _translationCache = {};
  }
  _cacheCount = Object.keys(_translationCache).length;
  return _translationCache!;
}

function persistTranslationCache() {
  try {
    const cache = getTranslationCache();
    // Evict oldest entries if over limit (FIFO by insertion order)
    if (_cacheCount > TRANSLATION_CACHE_MAX_ENTRIES) {
      const keys = Object.keys(cache);
      const toRemove = keys.slice(0, keys.length - TRANSLATION_CACHE_MAX_ENTRIES);
      for (const k of toRemove) delete cache[k];
      _cacheCount = TRANSLATION_CACHE_MAX_ENTRIES;
    }
    localStorage.setItem(TRANSLATION_CACHE_KEY, JSON.stringify(cache));
  } catch { /* quota exceeded – silently skip */ }
}

/**
 * Clear the translation cache (both in-memory and localStorage).
 * Called when user manually clears lyrics cache.
 */
export function clearTranslationCache() {
  _translationCache = {};
  _cacheCount = 0;
  try {
    localStorage.removeItem(TRANSLATION_CACHE_KEY);
  } catch { /* ignore */ }
  console.log("[SpicyLyrics:Translation] Cache cleared");
}

function translationCacheKey(text: string, targetLang: string): string {
  return `${targetLang}:${text}`;
}

const SCRIPT_TESTS = {
  han: /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/,
  kana: /[\u3040-\u30FF]/,
  hangul: /[\uAC00-\uD7AF]/,
  cyrillic: /[\u0400-\u04FF]/,
  greek: /[\u0370-\u03FF]/,
};

const latinTargetLanguages = new Set([
  "en", "es", "fr", "de", "it", "pt", "nl", "pl", "sv", "da", "no", "fi", "tr", "id", "ms", "vi",
]);

function targetAllowsScript(targetLang: string, script: keyof typeof SCRIPT_TESTS): boolean {
  if (script === "han") return targetLang.startsWith("zh") || targetLang === "ja";
  if (script === "kana") return targetLang === "ja";
  if (script === "hangul") return targetLang === "ko";
  if (script === "cyrillic") return ["ru", "uk", "bg", "sr", "mk", "be"].includes(targetLang);
  if (script === "greek") return targetLang === "el";
  return false;
}

function hasObviousNonTargetScript(text: string, targetLang: string): boolean {
  return (Object.keys(SCRIPT_TESTS) as Array<keyof typeof SCRIPT_TESTS>).some((script) =>
    SCRIPT_TESTS[script].test(text) && !targetAllowsScript(targetLang, script)
  );
}

function lineLooksNonTargetLatin(text: string, targetLang: string): boolean {
  if (!latinTargetLanguages.has(targetLang)) return false;
  const compact = text.replace(/[^\p{L}\s']/gu, " ").replace(/\s+/g, " ").trim();
  if (compact.length < 24) return false;
  const detected = franc(compact);
  if (detected === "und") return false;
  const detectedISO2 = langs.where("3", detected)?.["1"];
  return !!detectedISO2 && detectedISO2 !== targetLang;
}

function shouldTranslateLine(text: string, sourceLang: string, targetLang: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "♪") return false;

  const sourceISO2 = langs.where("3", sourceLang)?.["1"];
  const sourceMatchesTarget = sourceISO2 === targetLang || sourceLang === targetLang;

  if (!sourceMatchesTarget) return true;
  if (hasObviousNonTargetScript(trimmed, targetLang)) return true;
  return lineLooksNonTargetLatin(trimmed, targetLang);
}

function joinSyllableText(syllables: any[] | undefined): string {
  if (!Array.isArray(syllables) || syllables.length === 0) return "";
  let lineText = "";
  let previousWasWordEnd = false;
  for (const syl of syllables) {
    const text = syl?.Text || "";
    if (!text) continue;
    if (previousWasWordEnd && lineText && !lineText.endsWith(" ")) lineText += " ";
    lineText += text;
    previousWasWordEnd = syl?.IsPartOfWord === false;
  }
  return lineText.trim();
}

// ─── Batch Translation ────────────────────────────────────────────────────────

/**
 * Batch-translate an array of lines via Google Translate free API.
 * Returns an array of translated strings (same length as input).
 * Uses heavy caching: checks cache first, only sends un-cached lines to API,
 * then merges results back.
 */
export async function batchTranslate(
  lines: string[],
  sourceLang: string,
  targetLang: string,
): Promise<string[]> {
  const cache = getTranslationCache();
  const results: string[] = new Array(lines.length).fill("");
  const uncachedIndices: number[] = [];
  const uncachedTexts: string[] = [];

  // 1. Check cache first
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim();
    if (!text || text === "♪" || text === " ♪ ") {
      results[i] = "";
      continue;
    }
    const key = translationCacheKey(text, targetLang);
    if (cache[key]) {
      results[i] = cache[key];
    } else {
      uncachedIndices.push(i);
      uncachedTexts.push(text);
    }
  }

  if (uncachedTexts.length === 0) {
    console.log("[SpicyLyrics:Translation] All lines served from cache");
    return results;
  }

  console.log(`[SpicyLyrics:Translation] Translating ${uncachedTexts.length}/${lines.length} uncached lines (${sourceLang} → ${targetLang})`);

  // Map franc/ISO 639-3 source lang to Google's ISO 639-1 code (once per batch)
  const slCode = sourceLang === "und" ? "auto"
    : (langs.where("3", sourceLang)?.["1"] || "auto");

  // 2. Translate one lyric line per request. Google newline-batch responses can
  // merge/drop/reorder line boundaries, which assigns neighboring translations to
  // short repeated lines (e.g. "yeah") and bypasses duplicate suppression.
  const CHUNK_SIZE = 1;
  for (let ci = 0; ci < uncachedTexts.length; ci += CHUNK_SIZE) {
    const chunk = uncachedTexts.slice(ci, ci + CHUNK_SIZE);
    const chunkIndices = uncachedIndices.slice(ci, ci + CHUNK_SIZE);

    // Join with newline separator for batch translation
    const joined = chunk.join("\n");

    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(slCode)}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(joined)}`;

      const resp = await fetch(url);
      if (!resp.ok) {
        console.warn(`[SpicyLyrics:Translation] API returned ${resp.status}`);
        continue;
      }

      const data = await resp.json();

      // Google returns [[["translated\n...", "source\n...", ...], ...], ...]
      // Reassemble all translated segments
      let fullTranslation = "";
      if (Array.isArray(data) && Array.isArray(data[0])) {
        for (const segment of data[0]) {
          if (segment && typeof segment[0] === "string") {
            fullTranslation += segment[0];
          }
        }
      }

      const translatedLines = fullTranslation.split("\n");

      // Map back to results and cache. Google sometimes drops/merges newline
      // boundaries inside batch responses; empty slots get retried individually below.
      for (let j = 0; j < chunkIndices.length; j++) {
        const idx = chunkIndices[j];
        const translated = (translatedLines[j] || "").trim();
        results[idx] = translated;
        // Cache the result
        const originalText = lines[idx].trim();
        if (translated && originalText) {
          const key = translationCacheKey(originalText, targetLang);
          if (!cache[key]) {
            _cacheCount++;
          }
          cache[key] = translated;
        }
      }
    } catch (err) {
      console.error("[SpicyLyrics:Translation] Fetch error:", err);
    }
  }

  const missingIndices = uncachedIndices.filter((idx) => !results[idx]?.trim());
  if (missingIndices.length > 0) {
    console.warn(`[SpicyLyrics:Translation] Retrying ${missingIndices.length} missing batch translations individually`);
    for (const idx of missingIndices) {
      const originalText = lines[idx].trim();
      if (!originalText) continue;
      try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(slCode)}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(originalText)}`;
        const resp = await fetch(url);
        if (!resp.ok) continue;
        const data = await resp.json();
        let translated = "";
        if (Array.isArray(data) && Array.isArray(data[0])) {
          for (const segment of data[0]) {
            if (segment && typeof segment[0] === "string") translated += segment[0];
          }
        }
        translated = translated.trim();
        if (translated) {
          results[idx] = translated;
          const key = translationCacheKey(originalText, targetLang);
          if (!cache[key]) _cacheCount++;
          cache[key] = translated;
        }
      } catch (err) {
        console.error("[SpicyLyrics:Translation] Individual retry error:", err);
      }
    }
  }

  // 3. Persist cache to localStorage
  persistTranslationCache();

  return results;
}

// ─── Lyrics Translation ───────────────────────────────────────────────────────

/**
 * Translate all lines in the lyrics object and store as TranslatedText.
 * Called after romanization is complete.
 */
export async function translateLyrics(lyrics: any): Promise<void> {
  if (!translationEnabled || !translationTargetLang) return;

  const sourceLang = lyrics.Language || "und";
  const targetLang = translationTargetLang;

  // Collect all line texts
  const lineTexts: string[] = [];
  const lineRefs: Array<{ obj: any; field: string }> = [];

  if (lyrics.Type === "Static") {
    for (const line of lyrics.Lines) {
      lineTexts.push(line.Text || "");
      lineRefs.push({ obj: line, field: "TranslatedText" });
    }
  } else if (lyrics.Type === "Line") {
    for (const vocalGroup of lyrics.Content) {
      if (vocalGroup.Text) {
        lineTexts.push(vocalGroup.Text);
        lineRefs.push({ obj: vocalGroup, field: "TranslatedText" });
      }
    }
  } else if (lyrics.Type === "Syllable") {
    for (const vocalGroup of lyrics.Content) {
      if (vocalGroup.Type === "Vocal") {
        // Build full line text from syllables
        const lineText = joinSyllableText(vocalGroup.Lead.Syllables);
        lineTexts.push(lineText);
        lineRefs.push({ obj: vocalGroup.Lead, field: "TranslatedText" });

        // Background vocals
        if (vocalGroup.Background) {
          for (const bg of vocalGroup.Background) {
            const bgText = joinSyllableText(bg.Syllables);
            lineTexts.push(bgText);
            lineRefs.push({ obj: bg, field: "TranslatedText" });
          }
        }
      }
    }
  }

  if (lineTexts.length === 0) return;

  const candidateIndices = lineTexts
    .map((text, index) => shouldTranslateLine(text, sourceLang, targetLang) ? index : -1)
    .filter((index) => index >= 0);

  if (candidateIndices.length === 0) {
    for (const ref of lineRefs) delete ref.obj[ref.field];
    lyrics.IncludesTranslation = false;
    console.log("[SpicyLyrics:Translation] No mixed-language lines need translation");
    return;
  }

  const candidateTexts = candidateIndices.map((index) => lineTexts[index]);
  const translations = await batchTranslate(candidateTexts, "und", targetLang);

  let assignedCount = 0;
  for (let i = 0; i < lineRefs.length; i++) {
    delete lineRefs[i].obj[lineRefs[i].field];
  }

  // Assign translated text to candidate line objects
  for (let i = 0; i < candidateIndices.length; i++) {
    const originalIndex = candidateIndices[i];
    const translated = translations[i];
    if (isMeaningfullyDifferent(translated, lineTexts[originalIndex])) {
      lineRefs[originalIndex].obj[lineRefs[originalIndex].field] = translated;
      assignedCount++;
    }
  }

  lyrics.IncludesTranslation = assignedCount > 0;
  console.log(`[SpicyLyrics:Translation] Done. ${assignedCount}/${lineTexts.length} lines translated (${candidateIndices.length} candidates)`);
}
