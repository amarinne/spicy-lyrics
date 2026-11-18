export type ChineseReadingMode = "pinyin" | "jyutping" | "pinyin-vn" | "jyutping-vn";
export type ChineseTranslitMode = ChineseReadingMode | "auto" | "auto-vn" | "rhyme" | "rhyme-vn";
export type ChineseLanguage = "cmn" | "yue";

export function isAutoChineseMode(mode: string): boolean {
  return isAudioChineseMode(mode) || isRhymeChineseMode(mode);
}

export function isAudioChineseMode(mode: string): boolean {
  return mode === "auto" || mode === "auto-vn";
}

export function isRhymeChineseMode(mode: string): boolean {
  return mode === "rhyme" || mode === "rhyme-vn";
}

export function resolveChineseTranslitMode(mode: ChineseTranslitMode, language?: ChineseLanguage): ChineseReadingMode {
  if (!isAutoChineseMode(mode)) return mode as ChineseReadingMode;
  const eza = mode.endsWith("-vn");
  return language === "yue"
    ? eza ? "jyutping-vn" : "jyutping"
    : eza ? "pinyin-vn" : "pinyin";
}
