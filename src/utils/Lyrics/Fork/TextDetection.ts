/**
 * Text Detection Patterns
 * 
 * Regular expressions for detecting various writing systems in lyrics.
 * Used to determine which romanization branch to use.
 * 
 * @fork-feature Extended language detection patterns
 */

// Korean Hangul (syllables, jamo, compatibility jamo, extended)
export const KoreanTextTest =
  /[\uac00-\ud7af]|[\u1100-\u11ff]|[\u3130-\u318f]|[\ua960-\ua97f]|[\ud7b0-\ud7ff]/;

// Chinese characters (CJK Unified Ideographs)
export const ChineseTextTest = /([\u4E00-\u9FFF])/;

// Japanese kana (hiragana and katakana)
export const JapaneseTextTest = /([ぁ-んァ-ン])/;

// Cyrillic (basic + supplements + extended) - requires 2+ consecutive chars
export const CyrillicTextTest = /[\u0400-\u04FF\u0500-\u052F\u2DE0-\u2DFF\uA640-\uA69F]{2,}/;

// Greek (Basic + Extended)
export const GreekTextTest = /[\u0370-\u03FF\u1F00-\u1FFF]/;

// Devanagari
export const DevanagariTextTest = /[\u0900-\u097F]/;

// Gurmukhi
export const GurmukhiTextTest = /[\u0A00-\u0A7F]/;

// Bengali
export const BengaliTextTest = /[\u0980-\u09FF]/;

// CJK Ideographs remaining after romanization (indicates failed conversion)
// Includes: CJK Unified, CJK Extension A, iteration mark 々
export const CJKIdeographTest = /[\u4E00-\u9FFF\u3400-\u4DBF\u3005]/;

export function cleanInvisibles(text: string): string {
  return text
    .replace(/[\u200B\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Remove invisible markers without destroying timing-span edge whitespace. */
export function cleanInvisiblesPreserveEdges(text: string): string {
  return text
    .replace(/[\u200B\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]{2,}/g, " ");
}

/**
 * Detect the primary script type in text.
 * Returns the first matching script type found.
 */
export type ScriptType = "japanese" | "chinese" | "korean" | "cyrillic" | "greek" | "latin" | "unknown";

export type RomanizationBranch = "Japanese" | "Chinese" | "Korean" | "Cyrillic" | "Greek";

export const SCRIPT_PRIORITY: RomanizationBranch[] = [
  "Japanese",
  "Chinese",
  "Korean",
  "Cyrillic",
  "Greek",
];

export function detectScript(text: string): ScriptType {
  if (JapaneseTextTest.test(text)) return "japanese";
  if (ChineseTextTest.test(text)) return "chinese";
  if (KoreanTextTest.test(text)) return "korean";
  if (CyrillicTextTest.test(text)) return "cyrillic";
  if (GreekTextTest.test(text)) return "greek";
  if (/[a-zA-Z]/.test(text)) return "latin";
  return "unknown";
}

/**
 * Check if text contains any CJK characters (Chinese, Japanese kanji, or Korean hanja).
 */
export function hasCJK(text: string): boolean {
  return ChineseTextTest.test(text);
}

/**
 * Check if text contains Indic scripts used by translation gating.
 */
export function hasIndicScript(text: string): boolean {
  return DevanagariTextTest.test(text) || GurmukhiTextTest.test(text) || BengaliTextTest.test(text);
}

/**
 * Check if kuroshiro output still contains un-romanized kanji.
 * Used as a fallback trigger for buildRomajiFromTokens.
 */
export function hasUnromanizedKanji(text: string): boolean {
  return CJKIdeographTest.test(text);
}

/**
 * Check if text is primarily Cyrillic script.
 */
export function isCyrillic(text: string): boolean {
  return CyrillicTextTest.test(text);
}

/**
 * List of Cyrillic language codes (ISO 639-3).
 */
export const CYRILLIC_LANGUAGES = [
  "bel", // Belarusian
  "bul", // Bulgarian
  "kaz", // Kazakh
  "mkd", // Macedonian
  "rus", // Russian
  "srp", // Serbian
  "tgk", // Tajik
  "ukr", // Ukrainian
] as const;

/**
 * List of Cyrillic language codes (ISO 639-1).
 */
export const CYRILLIC_LANGUAGES_ISO2 = [
  "ky", // Kyrgyz
  "mn", // Mongolian
] as const;

/**
 * Check if a language code indicates Cyrillic script.
 */
export function isCyrillicLanguage(iso3: string, iso2?: string): boolean {
  return (
    (CYRILLIC_LANGUAGES as readonly string[]).includes(iso3) ||
    (iso2 !== undefined && (CYRILLIC_LANGUAGES_ISO2 as readonly string[]).includes(iso2))
  );
}

export function romanizationBranchFromLanguage(
  primaryLanguage: string,
  iso2Language?: string
): RomanizationBranch | undefined {
  if (primaryLanguage === "jpn") return "Japanese";
  if (primaryLanguage === "cmn" || primaryLanguage === "yue") return "Chinese";
  if (primaryLanguage === "kor") return "Korean";
  if (isCyrillicLanguage(primaryLanguage, iso2Language)) return "Cyrillic";
  if (primaryLanguage === "ell") return "Greek";
  return undefined;
}

export type ScriptBranchDocContext = {
  presentScripts: readonly RomanizationBranch[];
  primaryLanguage: string;
  iso2Language?: string;
};

const hanBranchForLine = (docContext: ScriptBranchDocContext): RomanizationBranch => {
  const hasDocJapanese = docContext.presentScripts.includes("Japanese");
  const hasDocChinese = docContext.presentScripts.includes("Chinese");

  if (hasDocJapanese && !hasDocChinese) return "Japanese";
  if (hasDocChinese && !hasDocJapanese) return "Chinese";

  const languageBranch = romanizationBranchFromLanguage(docContext.primaryLanguage, docContext.iso2Language);
  if (languageBranch === "Japanese" || languageBranch === "Chinese") return languageBranch;

  return hasDocJapanese ? "Japanese" : "Chinese";
};

export function scriptBranchForLine(
  lineText: string,
  docContext: ScriptBranchDocContext
): RomanizationBranch[] {
  const text = cleanInvisibles(lineText.normalize("NFKC"));
  const present = new Set<RomanizationBranch>();

  if (JapaneseTextTest.test(text)) {
    present.add("Japanese");
  } else if (ChineseTextTest.test(text)) {
    present.add(hanBranchForLine(docContext));
  }
  if (KoreanTextTest.test(text)) present.add("Korean");
  if (CyrillicTextTest.test(text)) present.add("Cyrillic");
  if (GreekTextTest.test(text)) present.add("Greek");

  return SCRIPT_PRIORITY.filter((script) => present.has(script));
}
