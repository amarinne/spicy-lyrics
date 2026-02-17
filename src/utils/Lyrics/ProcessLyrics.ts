import transliterPkg from "npm:transliter";
import { franc } from "npm:franc-all";
import Kuroshiro from "npm:kuroshiro";
import langs from "npm:langs";
import { getJyutpingList } from "npm:to-jyutping";
import { RetrievePackage } from "../ImportPackage.ts";
import * as KuromojiAnalyzer from "./KuromojiAnalyzer.ts";
import { PageContainer } from "../../components/Pages/PageView.ts";
import { chineseTranslitMode, translationEnabled, translationTargetLang } from "./lyrics.ts";

// Constants
const RomajiConverter = new Kuroshiro();
const RomajiPromise = RomajiConverter.init(KuromojiAnalyzer);

const KoreanTextTest =
  /[\uac00-\ud7af]|[\u1100-\u11ff]|[\u3130-\u318f]|[\ua960-\ua97f]|[\ud7b0-\ud7ff]/;
const ChineseTextText = /([\u4E00-\u9FFF])/;
const JapaneseTextText = /([ぁ-んァ-ン])/;

// Cyrillic (basic + supplements + extended)
const CyrillicTextTest = /[\u0400-\u04FF\u0500-\u052F\u2DE0-\u2DFF\uA640-\uA69F]{2,}/;

// Greek (Basic + Extended)
const GreekTextTest = /[\u0370-\u03FF\u1F00-\u1FFF]/;

// Load Packages
RetrievePackage("pinyin", "4.0.0", "mjs")
  .catch(() => {});

RetrievePackage("aromanize", "1.0.0", "js")
  .catch(() => {});

RetrievePackage("GreekRomanization", "1.0.0", "js")
  .catch(() => {});

const RomanizeKorean = async (lyricMetadata: any, primaryLanguage: string) => {
  const aromanize = await RetrievePackage("aromanize", "1.0.0", "js");
  while (!aromanize) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (primaryLanguage === "kor" || KoreanTextTest.test(lyricMetadata.Text)) {
    lyricMetadata.RomanizedText = aromanize.default(
      lyricMetadata.Text,
      "RevisedRomanizationTransliteration"
    );
  }
};

const RomanizeChinese = async (lyricMetadata: any, primaryLanguage: string) => {
  const pinyin = await RetrievePackage("pinyin", "4.0.0", "mjs");
  while (!pinyin) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (primaryLanguage === "cmn" || primaryLanguage === "yue" || ChineseTextText.test(lyricMetadata.Text)) {
    const result = pinyin.pinyin(lyricMetadata.Text, {
      segment: false,
      group: false,
    });

    // Result format: array of [reading] arrays when group=false
    // Handle both array-of-arrays and array-of-strings formats
    const readings: string[] = [];
    for (const item of result) {
      const reading = Array.isArray(item) ? item[0] : item;
      if (typeof reading === "string" && reading.trim().length > 0) {
        readings.push(reading);
      }
    }
    lyricMetadata.RomanizedText = readings.join(" ");
  }
};

const RomanizeCantonese = async (lyricMetadata: any, primaryLanguage: string) => {
  if (primaryLanguage === "cmn" || primaryLanguage === "yue" || ChineseTextText.test(lyricMetadata.Text)) {
    const text = lyricMetadata.Text;
    const list = getJyutpingList(text);
    if (list) {
      lyricMetadata.RomanizedText = list
        .map(([_char, reading]: [string, string | null]) => reading || _char)
        .filter((s: string) => s.trim().length > 0)
        .join(" ");
    }
  }
};

// Regex to detect remaining CJK ideographs (incl. 々 iteration mark) in kuroshiro output
const CJKIdeographTest = /[\u4E00-\u9FFF\u3400-\u4DBF\u3005]/;

const RomanizeJapanese = async (lyricMetadata: any, primaryLanguage: string) => {
  if (primaryLanguage === "jpn" || JapaneseTextText.test(lyricMetadata.Text)) {
    await RomajiPromise;

    let result = await RomajiConverter.convert(lyricMetadata.Text, {
      to: "romaji",
      mode: "spaced",
    });

    // Fallback: if kuroshiro still left kanji un-romanized, rebuild from kuromoji tokens
    if (CJKIdeographTest.test(result)) {
      const rebuilt = await buildRomajiFromTokens(lyricMetadata.Text);
      if (rebuilt) {
        result = rebuilt;
      }
    }

    lyricMetadata.RomanizedText = result;
  }
};

// Build complete romaji from kuromoji tokens with JUKUJIKUN overrides
// This is the robust fallback when kuroshiro fails to convert certain kanji
const buildRomajiFromTokens = async (text: string): Promise<string | null> => {
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
};

const RomanizeCyrillic = async (lyricMetadata: any, primaryLanguage: string, iso2Lang: string) => {
  if (
    primaryLanguage === "bel" ||
    primaryLanguage === "bul" ||
    primaryLanguage === "kaz" ||
    iso2Lang === "ky" ||
    primaryLanguage === "mkd" ||
    iso2Lang === "mn" ||
    primaryLanguage === "rus" ||
    primaryLanguage === "srp" ||
    primaryLanguage === "tgk" ||
    primaryLanguage === "ukr" ||
    CyrillicTextTest.test(lyricMetadata.Text)
  ) {
    const result = transliterPkg.transliter(lyricMetadata.Text, "bgn-pcgn");
    if (result != null) {
      // Replace remaining diacritics with plain ASCII equivalents
      lyricMetadata.RomanizedText = result
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
  }
};

const RomanizeGreek = async (lyricMetadata: any, primaryLanguage: string) => {
  const greekRomanization = await RetrievePackage("GreekRomanization", "1.0.0", "js");
  while (!greekRomanization) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (primaryLanguage === "ell" || GreekTextTest.test(lyricMetadata.Text)) {
    const result = greekRomanization.default(lyricMetadata.Text);
    if (result != null) {
      lyricMetadata.RomanizedText = result;
    }
  }
};

const Romanize = async (lyricMetadata: any, rootInformation: any): Promise<string | undefined> => {
  const primaryLanguage = rootInformation.Language;
  const iso2Language = rootInformation.LanguageISO2;
  try {
    // NFKC normalize: converts Kangxi Radicals (U+2F00–U+2FDF), CJK Compatibility
    // Ideographs, and other Unicode variants to standard CJK codepoints.
    // Some lyric sources use these lookalike characters which kuroshiro/kuromoji can't process.
    if (lyricMetadata.Text) {
      lyricMetadata.Text = lyricMetadata.Text.normalize("NFKC");
    }
    const textSample = (lyricMetadata.Text || "").substring(0, 50);
    const hasJpnChars = JapaneseTextText.test(lyricMetadata.Text || "");
    const hasChnChars = ChineseTextText.test(lyricMetadata.Text || "");
    console.log("[SpicyLyrics:Debug] Romanize called. lang:", primaryLanguage, "hasJpn:", hasJpnChars, "hasChn:", hasChnChars, "text:", textSample);
    if (primaryLanguage === "jpn" || hasJpnChars) {
      await RomanizeJapanese(lyricMetadata, primaryLanguage);
      rootInformation.IncludesRomanization = true;
      console.log("[SpicyLyrics:Debug] Romanized as Japanese:", (lyricMetadata.RomanizedText || "").substring(0, 50));
      return "Japanese";
    } else if (primaryLanguage === "cmn" || primaryLanguage === "yue" || hasChnChars) {
      if (chineseTranslitMode === "jyutping") {
        await RomanizeCantonese(lyricMetadata, primaryLanguage);
      } else {
        await RomanizeChinese(lyricMetadata, primaryLanguage);
      }
      rootInformation.IncludesRomanization = true;
      rootInformation.DetectedChinese = true;
      return "Chinese";
    } else if (primaryLanguage === "kor" || KoreanTextTest.test(lyricMetadata.Text)) {
      await RomanizeKorean(lyricMetadata, primaryLanguage);
      rootInformation.IncludesRomanization = true;
      return "Korean";
    } else if (
    primaryLanguage === "bel" ||
    primaryLanguage === "bul" ||
    primaryLanguage === "kaz" ||
    iso2Language === "ky" ||
    primaryLanguage === "mkd" ||
    iso2Language === "mn" ||
    primaryLanguage === "rus" ||
    primaryLanguage === "srp" ||
    primaryLanguage === "tgk" ||
    primaryLanguage === "ukr" ||
    CyrillicTextTest.test(lyricMetadata.Text)
  ) {
    await RomanizeCyrillic(lyricMetadata, primaryLanguage, iso2Language);
    rootInformation.IncludesRomanization = true;
    return "Cyrillic";
  } else if (primaryLanguage === "ell" || GreekTextTest.test(lyricMetadata.Text)) {
    await RomanizeGreek(lyricMetadata, primaryLanguage);
    rootInformation.IncludesRomanization = true;
    return "Greek";
  } else {
    return undefined;
  }
  } catch (err) {
    console.error("[SpicyLyrics] Romanization error:", err);
    return undefined;
  }
};

// Jukujikun / compound readings that kuromoji's ipadic may split incorrectly
const JUKUJIKUN: Record<string, string> = {
  "一人": "hitori", "二人": "futari", "大人": "otona",
  "下手": "heta", "上手": "jouzu", "素人": "shirouto", "玄人": "kurouto",
  "今朝": "kesa", "明後日": "asatte",
  "果物": "kudamono", "眼鏡": "megane", "部屋": "heya",
  "紅葉": "momiji", "景色": "keshiki", "時計": "tokei",
  "一日": "tsuitachi", "二日": "futsuka", "三日": "mikka",
  "友達": "tomodachi", "土産": "miyage",
  "日々": "hibi", "言葉": "kotoba", "一つ": "hitotsu",
  "二つ": "futatsu", "三つ": "mittsu", "四つ": "yottsu",
  "五つ": "itsutsu", "七つ": "nanatsu", "八つ": "yattsu",
  "九つ": "kokonotsu", "十": "tou",
  "昨日": "kinou", "今日": "kyou", "明日": "ashita",
  "何処": "doko", "何時": "itsu", "何故": "naze",
  "相応しい": "fusawashii",
};

// Maps romaji to individual syllables using Kuroshiro's full-line output,
// kuromoji tokens for position mapping, compound reading corrections,
// and Japanese phonetic merging rules (っ doubling, long vowels).
const mapRomajiToJapaneseSyllables = async (
  lineText: string,
  fullSpacedRomaji: string,
  syllables: any[],
): Promise<void> => {
  await RomajiPromise;

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
    for (let len = Math.min(3, tokens.length - i); len >= 2; len--) {
      const combined = tokens.slice(i, i + len).map((t: any) => t.surface_form).join("");
      if (JUKUJIKUN[combined]) {
        entries[i].romaji = JUKUJIKUN[combined];
        entries[i].end = entries[i + len - 1].end;
        for (let j = 1; j < len; j++) entries[i + j].consumed = true;
        break;
      }
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
};

// ─── Translation (Google Translate free API + heavy caching) ────────────────

const TRANSLATION_CACHE_KEY = "spicy-lyrics:translationCache";
const TRANSLATION_CACHE_MAX_ENTRIES = 5000;

// In-memory mirror – loaded once from localStorage
let _translationCache: Record<string, string> | null = null;

function getTranslationCache(): Record<string, string> {
  if (_translationCache) return _translationCache;
  try {
    const raw = localStorage.getItem(TRANSLATION_CACHE_KEY);
    _translationCache = raw ? JSON.parse(raw) : {};
  } catch {
    _translationCache = {};
  }
  return _translationCache!;
}

function persistTranslationCache() {
  try {
    const cache = getTranslationCache();
    // Evict oldest entries if over limit (FIFO by insertion order)
    const keys = Object.keys(cache);
    if (keys.length > TRANSLATION_CACHE_MAX_ENTRIES) {
      const toRemove = keys.slice(0, keys.length - TRANSLATION_CACHE_MAX_ENTRIES);
      for (const k of toRemove) delete cache[k];
    }
    localStorage.setItem(TRANSLATION_CACHE_KEY, JSON.stringify(cache));
  } catch { /* quota exceeded – silently skip */ }
}

function translationCacheKey(text: string, targetLang: string): string {
  // Simple but collision-resistant key
  return `${targetLang}:${text}`;
}

/**
 * Batch-translate an array of lines via Google Translate free API.
 * Returns an array of translated strings (same length as input).
 * Uses heavy caching: checks cache first, only sends un-cached lines to API,
 * then merges results back.
 */
async function batchTranslate(
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

  // 2. Batch into chunks of ~50 lines to avoid URL length limits
  const CHUNK_SIZE = 50;
  for (let ci = 0; ci < uncachedTexts.length; ci += CHUNK_SIZE) {
    const chunk = uncachedTexts.slice(ci, ci + CHUNK_SIZE);
    const chunkIndices = uncachedIndices.slice(ci, ci + CHUNK_SIZE);

    // Join with newline separator for batch translation
    const joined = chunk.join("\n");

    try {
      // Map franc/ISO 639-3 source lang to Google's ISO 639-1 code
      const slCode = sourceLang === "und" ? "auto"
        : (langs.where("3", sourceLang)?.["1"] || "auto");

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
          cache[translationCacheKey(originalText, targetLang)] = translated;
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

/**
 * Translate all lines in the lyrics object and store as TranslatedText.
 * Called after romanization is complete.
 */
async function TranslateLyrics(lyrics: any): Promise<void> {
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

export const ProcessLyrics = async (lyrics: any) => {
  console.log("[SpicyLyrics:Debug] ProcessLyrics called. Type:", lyrics.Type, "Content length:", lyrics.Content?.length || lyrics.Lines?.length, "alt_api:", lyrics.alternative_api || false, "Language(pre):", lyrics.Language);
  lyrics.IncludesRomanization = false;
  const romanizationPromises: Promise<string | undefined>[] = [];
  if (lyrics.Type === "Static") {
    {
      let textToProcess = lyrics.Lines[0].Text;
      for (let index = 1; index < lyrics.Lines.length; index += 1) {
        textToProcess += `\n${lyrics.Lines[index].Text}`;
      }

      const language = franc(textToProcess);
      const languageISO2 = langs.where("3", language)?.["1"];
      console.log("[SpicyLyrics:Debug] Static franc result:", language, "iso2:", languageISO2, "text sample:", textToProcess.substring(0, 100));

      lyrics.Language = language;
      lyrics.LanguageISO2 = languageISO2;

    }

    for (const lyricMetadata of lyrics.Lines) {
      romanizationPromises.push(Romanize(lyricMetadata, lyrics));
    }
  } else if (lyrics.Type === "Line") {
    {
      const lines = [];
      for (const vocalGroup of lyrics.Content) {
        // Line-type items may or may not have Type="Vocal"; accept both
        const text = vocalGroup.Text;
        if (text) {
          lines.push(text);
        }
      }
      const textToProcess = lines.join("\n");

      const language = franc(textToProcess);
      const languageISO2 = langs.where("3", language)?.["1"];
      console.log("[SpicyLyrics:Debug] Line franc result:", language, "iso2:", languageISO2, "text sample:", textToProcess.substring(0, 100));

      lyrics.Language = language;
      lyrics.LanguageISO2 = languageISO2;

    }

    for (const vocalGroup of lyrics.Content) {
      // Line-type items may or may not have Type="Vocal"; accept both
      if (vocalGroup.Text) {
        romanizationPromises.push(Romanize(vocalGroup, lyrics));
      }
    }
  } else if (lyrics.Type === "Syllable") {
    {
      const lines = [];
      for (const vocalGroup of lyrics.Content) {
        if (vocalGroup.Type === "Vocal") {
          let text = vocalGroup.Lead.Syllables[0].Text;
          for (let index = 1; index < vocalGroup.Lead.Syllables.length; index += 1) {
            const syllable = vocalGroup.Lead.Syllables[index];
            text += `${syllable.IsPartOfWord ? "" : " "}${syllable.Text}`;
          }

          lines.push(text);
        }
      }
      const textToProcess = lines.join("\n");

      const language = franc(textToProcess);
      const languageISO2 = langs.where("3", language)?.["1"];
      console.log("[SpicyLyrics:Debug] Syllable franc result:", language, "iso2:", languageISO2, "text sample:", textToProcess.substring(0, 100));

      lyrics.Language = language;
      lyrics.LanguageISO2 = languageISO2;

    }

    for (const vocalGroup of lyrics.Content) {
      if (vocalGroup.Type === "Vocal") {
        // Clear any previous Lead-level romanization to force re-processing
        delete vocalGroup.Lead.RomanizedText;
        for (const syllable of vocalGroup.Lead.Syllables) {
          delete syllable.RomanizedText;
        }
        if (vocalGroup.Background) {
          for (const bg of vocalGroup.Background) {
            delete bg.RomanizedText;
            for (const syllable of bg.Syllables) {
              delete syllable.RomanizedText;
            }
          }
        }

        const primaryLanguage = lyrics.Language;
        const isJapanese = primaryLanguage === "jpn" || 
          vocalGroup.Lead.Syllables.some((s: any) => JapaneseTextText.test(s.Text));

        // Build full line text from syllables
        let lineText = "";
        if (isJapanese) {
          for (const syllable of vocalGroup.Lead.Syllables) {
            lineText += syllable.Text;
          }
        } else {
          lineText = vocalGroup.Lead.Syllables[0].Text;
          for (let i = 1; i < vocalGroup.Lead.Syllables.length; i++) {
            const syllable = vocalGroup.Lead.Syllables[i];
            lineText += (syllable.IsPartOfWord ? "" : " ") + syllable.Text;
          }
        }

        // Romanize the full line (context-aware, best quality)
        const lineMetadata = { Text: lineText, RomanizedText: undefined as string | undefined };
        romanizationPromises.push(
          Romanize(lineMetadata, lyrics).then(async () => {
            vocalGroup.Lead.RomanizedText = lineMetadata.RomanizedText;

            // Map full-line romaji back to individual syllables
            if (lineMetadata.RomanizedText) {
              if (isJapanese) {
                // Japanese: use kuromoji token mapping for accurate per-syllable romaji
                await mapRomajiToJapaneseSyllables(
                  lineText,
                  lineMetadata.RomanizedText,
                  vocalGroup.Lead.Syllables,
                );
              } else {
                // Non-Japanese: per-syllable romanization
                const isChinese = primaryLanguage === "cmn" || primaryLanguage === "yue" ||
                  vocalGroup.Lead.Syllables.some((s: any) => ChineseTextText.test(s.Text));
                for (let si = 0; si < vocalGroup.Lead.Syllables.length; si++) {
                  const syllable = vocalGroup.Lead.Syllables[si];
                  const syllMeta = { Text: syllable.Text, RomanizedText: undefined as string | undefined };
                  await Romanize(syllMeta, lyrics);
                  syllable.RomanizedText = syllMeta.RomanizedText || undefined;
                  // Chinese: each character is its own word, always add space between
                  if (isChinese && si > 0 && syllable.RomanizedText) {
                    syllable.RomajiSpaceBefore = true;
                  }
                }
              }
            }

            return undefined;
          })
        );

        // Handle Background vocals
        if (vocalGroup.Background !== undefined) {
          for (const bg of vocalGroup.Background) {
            let bgText = "";
            if (isJapanese) {
              for (const syllable of bg.Syllables) {
                bgText += syllable.Text;
              }
            } else {
              bgText = bg.Syllables[0]?.Text || "";
              for (let i = 1; i < bg.Syllables.length; i++) {
                const syllable = bg.Syllables[i];
                bgText += (syllable.IsPartOfWord ? "" : " ") + syllable.Text;
              }
            }
            const bgMetadata = { Text: bgText, RomanizedText: undefined as string | undefined };
            romanizationPromises.push(
              Romanize(bgMetadata, lyrics).then(async () => {
                bg.RomanizedText = bgMetadata.RomanizedText;

                // Map full-line romaji back to individual BG syllables
                if (bgMetadata.RomanizedText) {
                  if (isJapanese) {
                    await mapRomajiToJapaneseSyllables(
                      bgText,
                      bgMetadata.RomanizedText,
                      bg.Syllables,
                    );
                  } else {
                    const isBgChinese = primaryLanguage === "cmn" || primaryLanguage === "yue" ||
                      bg.Syllables.some((s: any) => ChineseTextText.test(s.Text));
                    for (let si = 0; si < bg.Syllables.length; si++) {
                      const syllable = bg.Syllables[si];
                      const syllMeta = { Text: syllable.Text, RomanizedText: undefined as string | undefined };
                      await Romanize(syllMeta, lyrics);
                      syllable.RomanizedText = syllMeta.RomanizedText || undefined;
                      if (isBgChinese && si > 0 && syllable.RomanizedText) {
                        syllable.RomajiSpaceBefore = true;
                      }
                    }
                  }
                }

                return undefined;
              })
            );
          }
        }
      }
    }
  }

  await Promise.all(romanizationPromises);
  console.log("[SpicyLyrics] ProcessLyrics done. IncludesRomanization:", lyrics.IncludesRomanization, "DetectedChinese:", lyrics.DetectedChinese, "Language:", lyrics.Language);
  if (lyrics.IncludesRomanization === true) {
    PageContainer?.classList.add("Lyrics_RomanizationAvailable");
  } else {
    PageContainer?.classList.remove("Lyrics_RomanizationAvailable");
  }
  if (lyrics.DetectedChinese === true) {
    PageContainer?.classList.add("Lyrics_ChineseDetected");
  } else {
    PageContainer?.classList.remove("Lyrics_ChineseDetected");
  }

  // Translation pass (after romanization) — batched + cached
  await TranslateLyrics(lyrics);
  if (lyrics.IncludesTranslation === true) {
    PageContainer?.classList.add("Lyrics_TranslationAvailable");
  } else {
    PageContainer?.classList.remove("Lyrics_TranslationAvailable");
  }
};
