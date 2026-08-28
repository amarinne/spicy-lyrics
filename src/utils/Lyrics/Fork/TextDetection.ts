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
export type CjkReadingBranch = Extract<RomanizationBranch, "Japanese" | "Chinese">;
export type CjkLineRoute = CjkReadingBranch | "MixedChinese";

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
 * Check if romanized output still contains un-romanized kanji.
 * Historical trigger for the retired legacy Japanese fallback path.
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

export function resolveCjkDocumentBranch(
  text: string,
  primaryLanguage: string,
  iso2Language?: string
): CjkReadingBranch | undefined {
  const lines = cleanInvisibles(text.normalize("NFKC")).split(/\r?\n/u);
  let kanaLines = 0;
  let hanOnlyLines = 0;

  for (const line of lines) {
    const hasKana = JapaneseTextTest.test(line);
    const hasHan = ChineseTextTest.test(line);
    if (hasKana) kanaLines += 1;
    else if (hasHan) hanOnlyLines += 1;
  }

  if (kanaLines === 0 && hanOnlyLines === 0) return undefined;
  if (hanOnlyLines >= 2 && hanOnlyLines >= kanaLines * 2) return "Chinese";
  if (kanaLines >= 2 && kanaLines >= hanOnlyLines) return "Japanese";

  const languageBranch = romanizationBranchFromLanguage(primaryLanguage, iso2Language);
  if (languageBranch === "Japanese" || languageBranch === "Chinese") return languageBranch;
  return kanaLines > hanOnlyLines ? "Japanese" : "Chinese";
}

export type ScriptBranchDocContext = {
  presentScripts: readonly RomanizationBranch[];
  primaryLanguage: string;
  iso2Language?: string;
  cjkDominantBranch?: CjkReadingBranch;
};

const hanBranchForLine = (docContext: ScriptBranchDocContext): RomanizationBranch => {
  if (docContext.cjkDominantBranch) return docContext.cjkDominantBranch;
  const hasDocJapanese = docContext.presentScripts.includes("Japanese");
  const hasDocChinese = docContext.presentScripts.includes("Chinese");

  if (hasDocJapanese && !hasDocChinese) return "Japanese";
  if (hasDocChinese && !hasDocJapanese) return "Chinese";

  const languageBranch = romanizationBranchFromLanguage(docContext.primaryLanguage, docContext.iso2Language);
  if (languageBranch === "Japanese" || languageBranch === "Chinese") return languageBranch;

  return hasDocJapanese ? "Japanese" : "Chinese";
};

export function resolveCjkLineRoute(
  lineText: string,
  docContext: ScriptBranchDocContext
): CjkLineRoute | undefined {
  const text = cleanInvisibles(lineText.normalize("NFKC"));
  const hasKana = JapaneseTextTest.test(text);
  const hasHan = ChineseTextTest.test(text);
  if (!hasKana) return hasHan ? hanBranchForLine(docContext) as CjkReadingBranch : undefined;
  if (!hasHan || docContext.cjkDominantBranch !== "Chinese") return "Japanese";

  let kanaCount = 0;
  let hanCount = 0;
  let kanaRuns = 0;
  let inKanaRun = false;
  let firstCjk: CjkReadingBranch | undefined;
  let lastCjk: CjkReadingBranch | undefined;

  for (const char of Array.from(text)) {
    if (JapaneseTextTest.test(char)) {
      kanaCount += 1;
      if (!inKanaRun) kanaRuns += 1;
      inKanaRun = true;
      firstCjk ||= "Japanese";
      lastCjk = "Japanese";
    } else if (ChineseTextTest.test(char)) {
      hanCount += 1;
      inKanaRun = false;
      firstCjk ||= "Chinese";
      lastCjk = "Chinese";
    }
  }

  const kanaIsInternal = firstCjk === "Chinese" && lastCjk === "Chinese";
  if (kanaRuns >= 2 || kanaIsInternal || kanaCount >= hanCount) return "Japanese";
  return "MixedChinese";
}

export function scriptBranchForLine(
  lineText: string,
  docContext: ScriptBranchDocContext
): RomanizationBranch[] {
  const text = cleanInvisibles(lineText.normalize("NFKC"));
  const present = new Set<RomanizationBranch>();

  const cjkRoute = resolveCjkLineRoute(text, docContext);
  if (cjkRoute === "Japanese") present.add("Japanese");
  else if (cjkRoute === "Chinese") present.add("Chinese");
  else if (cjkRoute === "MixedChinese") {
    present.add("Japanese");
    present.add("Chinese");
  }
  if (KoreanTextTest.test(text)) present.add("Korean");
  if (CyrillicTextTest.test(text)) present.add("Cyrillic");
  if (GreekTextTest.test(text)) present.add("Greek");

  return SCRIPT_PRIORITY.filter((script) => present.has(script));
}
