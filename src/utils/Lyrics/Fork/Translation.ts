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
import { isMeaningfullyDifferent } from "../TextCompare.ts";
import { romanizeCyrillic, romanizeKorean } from "./Romanization.ts";
import { canonicalTextFromSyllables } from "../Processing/ProviderBoundary.ts";
import {
  BengaliTextTest,
  DevanagariTextTest,
  GurmukhiTextTest,
} from "./TextDetection.ts";

// ─── Cache Configuration ──────────────────────────────────────────────────────

const TRANSLATION_CACHE_KEY = "spicy-lyrics:translationCache";
const TRANSLATION_CACHE_MAX_ENTRIES = 5000;
const GOOGLE_INITIAL_BACKOFF_MS = 900;
const GOOGLE_MAX_BACKOFF_MS = 8000;
export const TRANSLATION_BATCH_MAX_LINES = 100;
export const TRANSLATION_BATCH_MAX_CHARS = 4500;
export const BATCH_MARKER_PATTERN = /\[\[\s*SPX\s*_\s*(\d\s*\d\s*\d)\s*\]\]/gi;

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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let googleBackoffUntil = 0;
let googleBackoffMs = GOOGLE_INITIAL_BACKOFF_MS;

async function waitForGoogleBackoff(): Promise<void> {
  const waitMs = Math.max(0, googleBackoffUntil - Date.now());
  if (waitMs > 0) await sleep(waitMs);
}

function registerGoogleSuccess(): void {
  googleBackoffUntil = 0;
  googleBackoffMs = GOOGLE_INITIAL_BACKOFF_MS;
}

function registerGoogleFailure(): void {
  googleBackoffUntil = Date.now() + googleBackoffMs;
  googleBackoffMs = Math.min(googleBackoffMs * 2, GOOGLE_MAX_BACKOFF_MS);
}

function shouldRetryGoogle(errorOrStatus: unknown): boolean {
  if (typeof errorOrStatus === "number") return errorOrStatus === 429 || errorOrStatus >= 500;
  return true;
}

function extractGoogleTranslation(data: any): string {
  let translated = "";
  if (Array.isArray(data) && Array.isArray(data[0])) {
    for (const segment of data[0]) {
      if (segment && typeof segment[0] === "string") translated += segment[0];
    }
  }
  return translated.trim();
}

export function normalizeCompare(value: string | undefined | null): string {
  if (!value) return "";
  return value
    .normalize("NFKC")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/ң/g, "n")
    .replace(/ŋ/g, "n")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameComparableText(left: string | undefined | null, right: string | undefined | null): boolean {
  return normalizeCompare(left) === normalizeCompare(right);
}

function foldCentralAsianToRussianBase(value: string): string {
  return value
    .replace(/ң/g, "н").replace(/Ң/g, "Н")
    .replace(/ө/g, "о").replace(/Ө/g, "О")
    .replace(/ү/g, "у").replace(/Ү/g, "У")
    .replace(/ә/g, "а").replace(/Ә/g, "А")
    .replace(/ғ/g, "г").replace(/Ғ/g, "Г")
    .replace(/қ/g, "к").replace(/Қ/g, "К")
    .replace(/ұ/g, "у").replace(/Ұ/g, "У")
    .replace(/һ/g, "х").replace(/Һ/g, "Х");
}

export function romanizationCandidates(source: string): string[] {
  const out: string[] = [];
  if (SCRIPT_TESTS.cyrillic.test(source)) {
    out.push(romanizeCyrillic(source, "Russian", false));
    out.push(romanizeCyrillic(source, "Ukrainian", false));
    const folded = foldCentralAsianToRussianBase(source);
    if (folded !== source) out.push(romanizeCyrillic(folded, "Russian", false));
  }
  if (SCRIPT_TESTS.hangul.test(source)) {
    out.push(romanizeKorean(source, "spelling"));
    out.push(romanizeKorean(source, "pronunciation"));
    out.push(romanizeKorean(source, "spelling", "vn"));
    out.push(romanizeKorean(source, "pronunciation", "vn"));
    out.push(romanizeKorean(source, "pronunciation", "rr", true));
    out.push(romanizeKorean(source, "pronunciation", "vn", true));
  }
  // Chinese/Japanese romanizers are async/lazy-loaded on desktop; skip those
  // candidates here so echo filtering stays synchronous in translation flow.
  return out;
}

export function looksLikeRomanizationEcho(source: string, translated: string): boolean {
  if (!source.trim() || !translated.trim()) return false;
  const output = normalizeCompare(translated);
  if (!output) return false;
  return romanizationCandidates(source).some((candidate) =>
    candidate.trim() && output === normalizeCompare(candidate)
  );
}

export function shouldDisplayTranslation(source: string, translated: string): boolean {
  return !!translated.trim()
    && !sameComparableText(source, translated)
    && !looksLikeRomanizationEcho(source, translated);
}

function batchMarker(index: number): string {
  return `[[SPX_${String(index).padStart(3, "0")}]]`;
}

export function buildBatchQuery(lines: string[]): string {
  return lines.map((line, index) => `${batchMarker(index)} ${line}`).join("\n");
}

export function buildBatchChunks(lines: string[]): Array<{ start: number; lines: string[]; query: string }> {
  const chunks: Array<{ start: number; lines: string[]; query: string }> = [];
  let current: string[] = [];
  let currentStart = 0;
  let currentChars = 0;

  for (let index = 0; index < lines.length; index++) {
    const lineChars = lines[index].length + 14;
    if (
      current.length > 0
      && (current.length >= TRANSLATION_BATCH_MAX_LINES
        || currentChars + lineChars > TRANSLATION_BATCH_MAX_CHARS)
    ) {
      chunks.push({ start: currentStart, lines: current, query: buildBatchQuery(current) });
      current = [];
      currentStart = index;
      currentChars = 0;
    }
    current.push(lines[index]);
    currentChars += lineChars;
  }

  if (current.length > 0) {
    chunks.push({ start: currentStart, lines: current, query: buildBatchQuery(current) });
  }
  return chunks;
}

export function parseBatchTranslation(translated: string): Map<number, string> {
  const result = new Map<number, string>();
  if (!translated.trim()) return result;

  const pattern = new RegExp(BATCH_MARKER_PATTERN.source, BATCH_MARKER_PATTERN.flags);
  let current = -1;
  let textStart = -1;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(translated)) !== null) {
    if (current >= 0 && textStart >= 0) {
      const value = translated.slice(textStart, match.index).trim();
      if (value) result.set(current, value);
    }
    current = Number.parseInt(match[1].replace(/\s+/g, ""), 10);
    textStart = pattern.lastIndex;
  }

  if (current >= 0 && textStart >= 0) {
    const value = translated.slice(textStart).trim();
    if (value) result.set(current, value);
  }
  return result;
}

export function stripMarkerEcho(text: string, index: number): string {
  const digits = String(index).padStart(3, "0").split("").join("\\s*");
  const markerPattern = new RegExp(`\\[\\[\\s*SPX\\s*_\\s*${digits}\\s*\\]\\]`, "gi");
  return text.replace(markerPattern, "").trim();
}

async function requestGoogleTranslation(url: string): Promise<string> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await waitForGoogleBackoff();
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        lastError = resp.status;
        if (shouldRetryGoogle(resp.status)) registerGoogleFailure();
        if (attempt === 0 && shouldRetryGoogle(resp.status)) continue;
        console.warn(`[SpicyLyrics:Translation] API returned ${resp.status}`);
        return "";
      }
      const translation = extractGoogleTranslation(await resp.json());
      registerGoogleSuccess();
      return translation;
    } catch (error) {
      lastError = error;
      if (shouldRetryGoogle(error)) registerGoogleFailure();
      if (attempt === 0 && shouldRetryGoogle(error)) continue;
    }
  }
  console.error("[SpicyLyrics:Translation] Fetch error:", lastError);
  return "";
}

const SCRIPT_TESTS = {
  han: /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/,
  kana: /[\u3040-\u30FF]/,
  hangul: /[\uAC00-\uD7AF]/,
  cyrillic: /[\u0400-\u04FF]/,
  greek: /[\u0370-\u03FF]/,
  devanagari: DevanagariTextTest,
  gurmukhi: GurmukhiTextTest,
  bengali: BengaliTextTest,
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
  if (script === "devanagari") return ["hi", "mr", "ne", "sa"].includes(targetLang);
  if (script === "gurmukhi") return targetLang === "pa";
  if (script === "bengali") return ["bn", "as"].includes(targetLang);
  return false;
}

export function hasObviousNonTargetScript(text: string, targetLang: string): boolean {
  const target = targetLang.toLowerCase();
  return (Object.keys(SCRIPT_TESTS) as Array<keyof typeof SCRIPT_TESTS>).some((script) =>
    SCRIPT_TESTS[script].test(text) && !targetAllowsScript(target, script)
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

function looksLikeLatinLyricLine(text: string): boolean {
  const compact = text.replace(/[^\p{L}\s']/gu, " ").replace(/\s+/g, " ").trim();
  return compact.length >= 12 && compact.includes(" ");
}

export function shouldTranslateLine(text: string, sourceLang: string, targetLang: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "♪") return false;

  const sourceISO2 = langs.where("3", sourceLang)?.["1"];
  const sourceMatchesTarget = sourceISO2 === targetLang || sourceLang === targetLang;

  if (!sourceMatchesTarget) return true;
  if (hasObviousNonTargetScript(trimmed, targetLang)) return true;
  if (targetLang.toLowerCase() === "en" && looksLikeLatinLyricLine(trimmed)) return true;
  return lineLooksNonTargetLatin(trimmed, targetLang);
}

function joinSyllableText(syllables: any[] | undefined): string {
  if (!Array.isArray(syllables) || syllables.length === 0) return "";
  return canonicalTextFromSyllables(syllables).canonical.text;
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
  const results: string[] = Array.from({ length: lines.length }, () => "");
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
      if (shouldDisplayTranslation(text, cache[key])) {
        results[i] = cache[key];
      } else {
        delete cache[key];
        _cacheCount = Math.max(0, _cacheCount - 1);
        uncachedIndices.push(i);
        uncachedTexts.push(text);
      }
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

  // 2. Translate marked batches. Markers survive Google's line merging/reordering
  // well enough to map each translated segment back to its source line.
  for (const batch of buildBatchChunks(uncachedTexts)) {
    const chunkIndices = uncachedIndices.slice(batch.start, batch.start + batch.lines.length);
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(slCode)}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(batch.query)}`;
      const translatedLines = parseBatchTranslation(await requestGoogleTranslation(url));

      for (let j = 0; j < chunkIndices.length; j++) {
        const idx = chunkIndices[j];
        const originalText = lines[idx].trim();
        const translated = stripMarkerEcho(translatedLines.get(j) || "", j);
        if (!shouldDisplayTranslation(originalText, translated)) {
          results[idx] = "";
          continue;
        }
        results[idx] = translated;
        // Cache the result
        if (originalText) {
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
        const translated = await requestGoogleTranslation(url);
        if (shouldDisplayTranslation(originalText, translated)) {
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
  const { translationEnabled, translationTargetLang } = await import("../lyrics.ts");
  if (!translationEnabled || !translationTargetLang) return;
  const { $meaningBackend } = await import("../../stores.ts");
  if ($meaningBackend.get() === "ai_auto") {
    lyrics.IncludesTranslation = false;
    return;
  }

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
