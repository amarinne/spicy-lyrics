import type { ChineseCharacterForm } from "./ChineseCharacterConversion.ts";
import type { ChineseReadingPlacement } from "../uiState.ts";
import type { MeaningBackend } from "../stores.ts";

export type ProcessingContext = {
  translationEnabled: boolean;
  translationTargetLang: string;
  meaningBackend?: MeaningBackend;
  chineseTranslitMode: "pinyin" | "jyutping";
  chineseTones: boolean;
  joinMandarinWords: boolean;
  chineseReadingPlacement: ChineseReadingPlacement;
  chineseCharacterForm: ChineseCharacterForm;
  koreanDisplayMode: "wordTranslit" | "rrStandard" | "rrPronunciation" | "vnPronunciation";
  cyrillicRomanizationMode: "Russian" | "Ukrainian";
  cyrillicKeepSigns: boolean;
  japaneseReadingMode: "romaji" | "furigana" | "both";
};

export function buildProcessingContextKey(context: ProcessingContext): string {
  return JSON.stringify({
    translation: context.translationEnabled ? `${context.meaningBackend ?? "google"}:${context.translationTargetLang || ""}` : false,
    chineseTranslitMode: context.chineseTranslitMode,
    chineseTones: context.chineseTones,
    joinMandarinWords: context.joinMandarinWords,
    chineseReadingPlacement: context.chineseReadingPlacement,
    chineseCharacterForm: context.chineseCharacterForm,
    koreanDisplayMode: context.koreanDisplayMode,
    cyrillicRomanizationMode: context.cyrillicRomanizationMode,
    cyrillicKeepSigns: context.cyrillicKeepSigns,
    japaneseReadingMode: context.japaneseReadingMode,
  });
}
