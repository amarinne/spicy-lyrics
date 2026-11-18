import type { ChineseCharacterForm } from "./ChineseCharacterConversion.ts";
import type { ChineseReadingPlacement } from "../uiState.ts";
import type { MeaningBackend } from "../stores.ts";
import type { ChineseTranslitMode, ChineseReadingMode } from "./ChineseTranslitMode.ts";
import { isAudioChineseMode, isRhymeChineseMode } from "./ChineseTranslitMode.ts";
import { CHINESE_AUDIO_REVISION } from "./ChineseAudioDetection.ts";
import { CHINESE_RHYME_REVISION } from "./ChineseRhymeGuess.ts";
import { MANDARIN_READER_REVISION } from "./Fork/MandarinReaderIdentity.ts";
import { MANDARIN_EZA_REVISION } from "./Fork/MandarinEzaSandhi.ts";
import { MANDARIN_ZHUYIN_REVISION } from "./Fork/MandarinZhuyin.ts";

export type ProcessingContext = {
  translationEnabled: boolean;
  translationTargetLang: string;
  meaningBackend?: MeaningBackend;
  chineseTranslitMode: ChineseTranslitMode;
  resolvedChineseTranslitMode?: ChineseReadingMode;
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
    resolvedChineseTranslitMode: isAudioChineseMode(context.chineseTranslitMode) ? context.resolvedChineseTranslitMode : undefined,
    chineseAudioRevision: isAudioChineseMode(context.chineseTranslitMode) ? CHINESE_AUDIO_REVISION : undefined,
    chineseRhymeRevision: isRhymeChineseMode(context.chineseTranslitMode) ? CHINESE_RHYME_REVISION : undefined,
    mandarinReaderRevision: ["pinyin-vn", "auto-vn", "rhyme-vn"].includes(context.chineseTranslitMode) ? MANDARIN_READER_REVISION : undefined,
    mandarinEzaRevision: ["pinyin-vn", "auto-vn", "rhyme-vn"].includes(context.chineseTranslitMode) ? MANDARIN_EZA_REVISION : undefined,
    mandarinZhuyinRevision: MANDARIN_ZHUYIN_REVISION,
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
