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

// Shared token merge logic. Japanese readings should come from Kuromoji; keep
// this layer limited to spacing and tiny POS-guarded phonetic fixes.
export { computeNoSpaceBefore, type MergeableEntry } from "./JukujikunMerge.ts";

// Text detection patterns and utilities
export {
  KoreanTextTest,
  ChineseTextTest,
  JapaneseTextTest,
  CyrillicTextTest,
  GreekTextTest,
  DevanagariTextTest,
  GurmukhiTextTest,
  BengaliTextTest,
  CJKIdeographTest,
  cleanInvisibles,
  cleanInvisiblesPreserveEdges,
  detectScript,
  hasCJK,
  hasIndicScript,
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
