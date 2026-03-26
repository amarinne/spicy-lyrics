/**
 * Fork Customizations Index
 * 
 * Exports all fork-specific features for easy importing.
 * These modules extend upstream's functionality with:
 * - Additional romanization systems (Cantonese, improved Cyrillic)
 * - Google Translate integration
 * - Per-syllable karaoke sync
 * - Extended text detection
 * 
 * @fork-feature Main entry point for fork customizations
 */

// Jukujikun dictionary for compound kanji readings
export { JUKUJIKUN, getJukujikun, hasJukujikun } from "./JukujikuDict.ts";

// Shared jukujikun + token merge logic
export { applyJukujikun, computeNoSpaceBefore, type MergeableEntry } from "./JukujikunMerge.ts";

// Text detection patterns and utilities
export {
  KoreanTextTest,
  ChineseTextTest,
  JapaneseTextTest,
  CyrillicTextTest,
  GreekTextTest,
  CJKIdeographTest,
  detectScript,
  hasCJK,
  hasUnromanizedKanji,
  isCyrillic,
  isCyrillicLanguage,
  CYRILLIC_LANGUAGES,
  CYRILLIC_LANGUAGES_ISO2,
  type ScriptType,
} from "./TextDetection.ts";

// Romanization functions
export {
  romanizeCantonese,
  romanizeCyrillic,
  buildRomajiFromTokens,
  romanizeJapaneseWithFallback,
} from "./Romanization.ts";

// Translation (Google Translate integration)
export {
  clearTranslationCache,
  batchTranslate,
  translateLyrics,
} from "./Translation.ts";

// Syllable synchronization for karaoke
export { mapRomajiToJapaneseSyllables } from "./SyllableSync.ts";
