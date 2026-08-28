import { detectChineseCharacterForm, type ChineseCharacterForm } from "./ChineseCharacterConversion.ts";

export type HanLanguageTag = "ja" | "zh" | "zh-Hans" | "zh-Hant";
export type HanReadingPrimaryScript = "Japanese" | "Chinese";
export type HanLanguageContext = {
  enabled: boolean;
  characterForm?: ChineseCharacterForm;
  primaryScript?: HanReadingPrimaryScript;
  lineLanguage: HanLanguageTag | null;
};
export type HanLanguageRun = {
  text: string;
  language: HanLanguageTag | null;
};

const Kana = /[\u3040-\u30ff\u31f0-\u31ff]/u;
const Han = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const JapaneseLanguages = new Set(["ja", "jpn"]);
const ChineseLanguages = new Set(["zh", "zho", "chi", "cmn", "yue"]);

function resolveChineseTag(text: string, characterForm: ChineseCharacterForm): Exclude<HanLanguageTag, "ja"> {
  if (characterForm === "simplified") return "zh-Hans";
  if (characterForm === "traditional") return "zh-Hant";
  const detected = detectChineseCharacterForm(text);
  return detected === "simplified" ? "zh-Hans" : detected === "traditional" ? "zh-Hant" : "zh";
}

export function resolveHanLanguageTag(
  text: string,
  language?: string,
  iso2Language?: string,
  characterForm: ChineseCharacterForm = "original",
): HanLanguageTag | null {
  const primary = String(language ?? "").toLowerCase();
  const iso2 = String(iso2Language ?? "").toLowerCase();
  if (JapaneseLanguages.has(primary) || JapaneseLanguages.has(iso2)) {
    return Kana.test(text) || Han.test(text) ? "ja" : null;
  }
  if (ChineseLanguages.has(primary) || ChineseLanguages.has(iso2)) {
    if (Han.test(text)) return resolveChineseTag(text, characterForm);
    return Kana.test(text) ? "ja" : null;
  }
  if (Kana.test(text)) return "ja";
  return Han.test(text) ? resolveChineseTag(text, characterForm) : null;
}

export function createHanLanguageContext(
  lyrics: any,
  text: string,
  enabled: boolean,
  primaryScript?: HanReadingPrimaryScript,
): HanLanguageContext {
  const characterForm = lyrics?.ChineseCharacterForm;
  const lineLanguage = !enabled
    ? null
    : primaryScript === "Japanese"
      ? Kana.test(text) || Han.test(text) ? "ja" : null
      : primaryScript === "Chinese" && Han.test(text)
        ? resolveChineseTag(text, characterForm ?? "original")
        : resolveHanLanguageTag(text, lyrics?.Language, lyrics?.LanguageISO2, characterForm);
  return { enabled, characterForm, primaryScript, lineLanguage };
}

export function resolveHanLanguageTagForContext(
  text: string,
  context: HanLanguageContext | undefined,
): HanLanguageTag | null {
  if (!context?.enabled) return null;
  if (context.primaryScript === "Chinese" && Han.test(text)) {
    if (context.lineLanguage === "zh-Hans" || context.lineLanguage === "zh-Hant") {
      return context.lineLanguage;
    }
    if (context.characterForm === "simplified") return "zh-Hans";
    if (context.characterForm === "traditional") return "zh-Hant";
    return "zh";
  }
  if (Kana.test(text)) return "ja";
  if (!Han.test(text)) return null;
  if (context.primaryScript === "Japanese") return "ja";
  return context.lineLanguage;
}

export function splitHanLanguageRuns(
  text: string,
  context: HanLanguageContext | undefined,
): HanLanguageRun[] {
  if (!text) return [];
  if (!context?.enabled) return [{ text, language: null }];

  const sharedHanLanguage = context.primaryScript === "Japanese"
    ? "ja"
    : context.primaryScript === "Chinese"
      ? resolveHanLanguageTagForContext(text, context)
      : context.lineLanguage;
  const runs: HanLanguageRun[] = [];
  for (const character of text) {
    const language = Kana.test(character)
      ? "ja"
      : Han.test(character)
        ? sharedHanLanguage ?? resolveHanLanguageTagForContext(character, context)
        : null;
    const previous = runs[runs.length - 1];
    if (previous?.language === language) previous.text += character;
    else runs.push({ text: character, language });
  }
  return runs;
}

export function applyHanLanguageTag(element: HTMLElement, context: HanLanguageContext): void {
  if (context.lineLanguage) element.lang = context.lineLanguage;
}
