/**
 * Translation Module
 * 
 * Google Translate integration with localStorage caching.
 * Provides batch translation of lyrics lines with automatic
 * language detection and cache management.
 * 
 * @fork-feature Google Translate integration
 */

import langs from "langs";
import { translationEnabled, translationTargetLang } from "../lyrics.ts";

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

  // 2. Batch into chunks of ~50 lines to avoid URL length limits
  const CHUNK_SIZE = 50;
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

      // Map back to results and cache
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

  // Don't translate if source matches target
  const sourceISO2 = langs.where("3", sourceLang)?.["1"];
  if (sourceISO2 === targetLang || sourceLang === targetLang) {
    console.log("[SpicyLyrics:Translation] Source matches target, skipping");
    return;
  }

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
        let lineText = vocalGroup.Lead.Syllables[0]?.Text || "";
        for (let i = 1; i < vocalGroup.Lead.Syllables.length; i++) {
          const syl = vocalGroup.Lead.Syllables[i];
          lineText += (syl.IsPartOfWord ? "" : " ") + syl.Text;
        }
        lineTexts.push(lineText);
        lineRefs.push({ obj: vocalGroup.Lead, field: "TranslatedText" });

        // Background vocals
        if (vocalGroup.Background) {
          for (const bg of vocalGroup.Background) {
            let bgText = bg.Syllables[0]?.Text || "";
            for (let i = 1; i < bg.Syllables.length; i++) {
              const syl = bg.Syllables[i];
              bgText += (syl.IsPartOfWord ? "" : " ") + syl.Text;
            }
            lineTexts.push(bgText);
            lineRefs.push({ obj: bg, field: "TranslatedText" });
          }
        }
      }
    }
  }

  if (lineTexts.length === 0) return;

  const translations = await batchTranslate(lineTexts, sourceLang, targetLang);

  // Assign translated text to each line object
  for (let i = 0; i < lineRefs.length; i++) {
    const translated = translations[i];
    if (translated) {
      lineRefs[i].obj[lineRefs[i].field] = translated;
    }
  }

  lyrics.IncludesTranslation = true;
  console.log(`[SpicyLyrics:Translation] Done. ${translations.filter(t => t).length}/${lineTexts.length} lines translated`);
}
