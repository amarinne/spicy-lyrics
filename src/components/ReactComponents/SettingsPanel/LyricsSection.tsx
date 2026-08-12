import { useStore } from "@nanostores/react";
import React from "react";
import {
  $adaptiveSectioning,
  $lineHoverBackground,
  $minimalLyricsMode,
  $simpleLyricsMode,
  $simpleLyricsModeRenderingType,
  $meaningBackend,
  $soundBackend,
  $soundTargetOrthography,
  type MeaningBackend,
  type SoundBackend,
  type SoundOrthography,
} from "../../../utils/stores.ts";
import {
  $chineseCharacterForm,
  $chineseTones,
  $chineseTranslitMode,
  $cyrillicKeepSigns,
  $cyrillicRomanizationMode,
  $japaneseReadingMode,
  $joinMandarinWords,
  $koreanDisplayMode,
  $lyricsCopyFormat,
  $showChineseTranslitButton,
  $translationEnabled,
  $translationTargetLang,
} from "../../../utils/uiState.ts";
import { matches, Row, Select, SectionTitle, Toggle } from "./components.tsx";

const SECTION_NAME = "Lyrics Display";

const SIMPLE_RENDERING_OPTIONS = ["calculate", "animate"];
const CHINESE_TRANSLIT_OPTIONS = ["pinyin", "jyutping"];
const KOREAN_ROMANIZATION_OPTIONS = [
  { value: "wordTranslit", label: "Word-by-word transliteration" },
  { value: "rrStandard", label: "Standard Korean RR" },
  { value: "rrPronunciation", label: "Follow pronunciation (RR)" },
  { value: "vnPronunciation", label: "Follow pronunciation (VN)" },
] as const;
const CYRILLIC_ROMANIZATION_OPTIONS = ["Russian", "Ukrainian"];

const JAPANESE_READING_OPTIONS = [
  { value: "romaji", label: "Romaji line only" },
  { value: "furigana", label: "Furigana only" },
  { value: "both", label: "Furigana + romaji line" },
] as const;

const TRANSLATION_TARGETS = [
  { value: "en", label: "English" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh-CN", label: "Chinese (Simplified)" },
  { value: "zh-TW", label: "Chinese (Traditional)" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "pl", label: "Polish" },
  { value: "ru", label: "Russian" },
  { value: "uk", label: "Ukrainian" },
  { value: "tr", label: "Turkish" },
  { value: "id", label: "Indonesian" },
  { value: "vi", label: "Vietnamese" },
  { value: "th", label: "Thai" },
  { value: "hi", label: "Hindi" },
] as const;

const LYRICS_COPY_FORMAT_OPTIONS = [
  { value: "plain", label: "Plain lyrics" },
  { value: "timestamps", label: "Lyrics + timestamps" },
  { value: "translation", label: "Lyrics + translation" },
  { value: "metadata", label: "Artist/title + lyrics" },
] as const;

const optionValues = <T extends readonly { value: string }[]>(options: T) => options.map(({ value }) => value);
const optionLabels = <T extends readonly { label: string }[]>(options: T) => options.map(({ label }) => label);

interface Props {
  query: string;
  sectionFilter: string;
}

export default function LyricsSection({ query, sectionFilter }: Props) {
  const simpleLyricsMode = useStore($simpleLyricsMode);
  const simpleLyricsModeRenderingType = useStore($simpleLyricsModeRenderingType);
  const minimalLyricsMode = useStore($minimalLyricsMode);
  const adaptiveSectioning = useStore($adaptiveSectioning);
  const lineHoverBackground = useStore($lineHoverBackground);
  const chineseTranslitMode = useStore($chineseTranslitMode);
  const chineseTones = useStore($chineseTones);
  const chineseCharacterForm = useStore($chineseCharacterForm);
  const joinMandarinWords = useStore($joinMandarinWords);
  const japaneseReadingMode = useStore($japaneseReadingMode);
  const koreanDisplayMode = useStore($koreanDisplayMode);
  const cyrillicRomanizationMode = useStore($cyrillicRomanizationMode);
  const cyrillicKeepSigns = useStore($cyrillicKeepSigns);
  const translationEnabled = useStore($translationEnabled);
  const translationTargetLang = useStore($translationTargetLang);
  const meaningBackend = useStore($meaningBackend);
  const soundBackend = useStore($soundBackend);
  const soundTargetOrthography = useStore($soundTargetOrthography);
  const lyricsCopyFormat = useStore($lyricsCopyFormat);
  const showChineseTranslitButton = useStore($showChineseTranslitButton);

  if (sectionFilter !== "All" && sectionFilter !== SECTION_NAME) return null;

  const showSimpleLyricsMode = matches(query, "Simple Lyrics Mode", "Remove extra visual effects from lyrics");
  const showSimpleRenderingStyle = matches(query, "Simple Mode: Text Animation Style", "How lyrics text transitions are rendered in Simple Lyrics Mode.");
  const showMinimalLyricsMode = matches(query, "Minimal Lyrics Mode", "Hides sung lyrics lines in Fullscreen and Cinema Mode");
  const showAdaptiveSectioning = matches(query, "Adaptive Sectioning", "Keep Japanese semantic groups together and improve wrapping for reading and translation rows.");
  const showLineHoverBackground = matches(query, "Line Hover Background", "Show a highlight box behind a lyrics line when you hover over it.");
  const showChineseTransliteration = matches(query, "Chinese Transliteration", "Choose Mandarin pinyin or Cantonese jyutping for Chinese lyrics.");
  const showChineseTones = matches(query, "Chinese Tones", "Show Mandarin tone marks and Cantonese jyutping tone numbers.");
  const showChineseCharacterForm = matches(query, "Chinese Character Form", "Keep original characters or convert Chinese lyrics locally.");
  const showMandarinWordGrouping = matches(query, "Group Pinyin by Word", "Keep Pinyin syllables together when they form one Mandarin word.");
  const showJapaneseReadingDisplay = matches(query, "Japanese Reading Display", "Choose romaji, furigana, or both for Japanese lyrics.");
  const showKoreanDisplay = matches(query, "Korean Display", "Choose Korean transliteration mode for the extra romanized line.");
  const showCyrillicRomanization = matches(query, "Cyrillic Language", "Choose Russian or Ukrainian Cyrillic romanization rules.");
  const showCyrillicKeepSigns = matches(query, "Keep Cyrillic Signs", "Preserve Cyrillic hard and soft sign marks.");
  const showLyricsTranslation = matches(query, "Lyrics Translation", "Show translated lyrics under each line.");
  const showMeaningBackend = matches(query, "Translation Backend", "Choose Google or contextual AI translation with user steering.");
  const showSoundBackend = matches(query, "Sound Backend", "Choose built-in or AI pronunciation.");
  const showSoundTarget = matches(query, "Target Orthography", "Choose the script used for AI pronunciation.");
  const showTranslationTarget = matches(query, "Translation Target Language", "Language used for lyrics translation.");
  const showChineseQuickButton = matches(query, "Chinese Transliteration Quick Button", "Show the pinyin/jyutping toggle in lyrics controls when Chinese lyrics are detected.");
  const showCopyFormat = matches(query, "Copy Lyrics Format", "Choose what the lyrics copy button writes to clipboard.");

  const hasVisibleRows =
    showSimpleLyricsMode ||
    showSimpleRenderingStyle ||
    showMinimalLyricsMode ||
    showAdaptiveSectioning ||
    showLineHoverBackground ||
    showChineseTransliteration ||
    showChineseTones ||
    showChineseCharacterForm ||
    showMandarinWordGrouping ||
    showJapaneseReadingDisplay ||
    showKoreanDisplay ||
    showCyrillicRomanization ||
    showCyrillicKeepSigns ||
    showLyricsTranslation ||
    showMeaningBackend ||
    showSoundBackend ||
    showSoundTarget ||
    showTranslationTarget ||
    showChineseQuickButton ||
    showCopyFormat;

  if (!hasVisibleRows) return null;

  return (
    <>
      <SectionTitle>Lyrics Display</SectionTitle>

      {showSimpleLyricsMode && (
        <Row label="Simple Lyrics Mode" description="Remove extra visual effects from lyrics">
          <Toggle checked={simpleLyricsMode} onChange={(v) => $simpleLyricsMode.set(v)} />
        </Row>
      )}

      {showSimpleRenderingStyle && (
        <Row
          label="Simple Mode: Text Animation Style"
          description="How lyrics text transitions are rendered in Simple Lyrics Mode."
          disabled={!simpleLyricsMode}
          disabledReason="Enable Simple Lyrics Mode to modify this setting"
        >
          <Select
            value={simpleLyricsModeRenderingType}
            options={SIMPLE_RENDERING_OPTIONS}
            onChange={(v) => $simpleLyricsModeRenderingType.set(v)}
            disabled={!simpleLyricsMode}
          />
        </Row>
      )}

      {showMinimalLyricsMode && (
        <Row
          label="Minimal Lyrics Mode"
          description="Hides sung lyrics lines in Fullscreen and Cinema Mode"
        >
          <Toggle checked={minimalLyricsMode} onChange={(v) => $minimalLyricsMode.set(v)} />
        </Row>
      )}

      {showAdaptiveSectioning && (
        <Row
          label="Adaptive Sectioning"
          description="Keep Japanese semantic groups together and improve wrapping for reading and translation rows."
        >
          <Toggle checked={adaptiveSectioning} onChange={(v) => $adaptiveSectioning.set(v)} />
        </Row>
      )}

      {showLineHoverBackground && (
        <Row
          label="Line Hover Background"
          description="Show a highlight box behind a lyrics line when you hover over it."
        >
          <Toggle
            checked={lineHoverBackground}
            onChange={(v) => $lineHoverBackground.set(v)}
          />
        </Row>
      )}

      {showChineseTransliteration && (
        <Row label="Chinese Transliteration" description="Choose Mandarin pinyin or Cantonese jyutping for Chinese lyrics.">
          <Select
            value={chineseTranslitMode}
            options={CHINESE_TRANSLIT_OPTIONS}
            onChange={(v) => $chineseTranslitMode.set(v as "pinyin" | "jyutping")}
          />
        </Row>
      )}

      {showSoundBackend && (
        <Row label="Sound Backend">
          <Select value={soundBackend} options={["deterministic", "ai_auto", "ai_on_demand"]} labels={["Built-in", "AI automatic", "AI on demand"]} onChange={(value) => $soundBackend.set(value as SoundBackend)} />
        </Row>
      )}

      {showSoundTarget && soundBackend !== "deterministic" && (
        <Row label="Target Orthography">
          <Select value={soundTargetOrthography} options={["Latin", "Kana", "Hangul", "Cyrillic"]} onChange={(value) => $soundTargetOrthography.set(value as SoundOrthography)} />
        </Row>
      )}

      {showChineseCharacterForm && (
        <Row
          label="Chinese Character Form"
          description="Keep original characters or convert Chinese lyrics locally."
        >
          <Select
            value={chineseCharacterForm}
            options={["original", "simplified", "traditional"]}
            labels={["Original", "Simplified", "Traditional"]}
            onChange={(value) => $chineseCharacterForm.set(value as typeof chineseCharacterForm)}
          />
        </Row>
      )}

      {showChineseTones && (
        <Row label="Chinese Tones" description="Show Mandarin tone marks and Cantonese jyutping tone numbers.">
          <Toggle checked={chineseTones} onChange={(v) => $chineseTones.set(v)} />
        </Row>
      )}

      {showMandarinWordGrouping && (
        <Row
          label="Group Pinyin by Word"
          description="Keep Pinyin syllables together when they form one detected Mandarin word."
          disabled={chineseTranslitMode !== "pinyin"}
          disabledReason="Choose Mandarin Pinyin first."
        >
          <Toggle
            checked={joinMandarinWords}
            disabled={chineseTranslitMode !== "pinyin"}
            onChange={(value) => $joinMandarinWords.set(value)}
          />
        </Row>
      )}

      {showJapaneseReadingDisplay && (
        <Row label="Japanese Reading Display" description="Choose romaji, furigana, or both for Japanese lyrics.">
          <Select
            value={japaneseReadingMode}
            options={optionValues(JAPANESE_READING_OPTIONS)}
            labels={optionLabels(JAPANESE_READING_OPTIONS)}
            onChange={(v) => $japaneseReadingMode.set(v as "romaji" | "furigana" | "both")}
          />
        </Row>
      )}

      {showKoreanDisplay && (
        <Row label="Korean Display" description="Choose Korean transliteration mode for the extra romanized line.">
          <Select
            value={koreanDisplayMode}
            options={optionValues(KOREAN_ROMANIZATION_OPTIONS)}
            labels={optionLabels(KOREAN_ROMANIZATION_OPTIONS)}
            onChange={(v) => $koreanDisplayMode.set(v as "wordTranslit" | "rrStandard" | "rrPronunciation" | "vnPronunciation")}
          />
        </Row>
      )}

      {showCyrillicRomanization && (
        <Row label="Cyrillic Language" description="Choose Russian or Ukrainian Cyrillic romanization rules.">
          <Select
            value={cyrillicRomanizationMode}
            options={CYRILLIC_ROMANIZATION_OPTIONS}
            onChange={(v) => $cyrillicRomanizationMode.set(v as "Russian" | "Ukrainian")}
          />
        </Row>
      )}

      {showCyrillicKeepSigns && (
        <Row label="Keep Cyrillic Signs" description="Preserve Cyrillic hard and soft sign marks.">
          <Toggle checked={cyrillicKeepSigns} onChange={(v) => $cyrillicKeepSigns.set(v)} />
        </Row>
      )}

      {showLyricsTranslation && (
        <Row label="Lyrics Translation" description="Show translated lyrics under each line.">
          <Toggle checked={translationEnabled} onChange={(v) => $translationEnabled.set(v)} />
        </Row>
      )}

      {showMeaningBackend && (
        <Row label="Translation Backend" description="Choose how the Meaning layer is produced from original lyrics.">
          <Select value={meaningBackend} options={["google", "ai_auto", "ai_on_demand"]} labels={["Google Translate", "Contextual AI", "Contextual AI on demand"]} onChange={(value) => $meaningBackend.set(value as MeaningBackend)} />
        </Row>
      )}

      {showChineseQuickButton && (
        <Row label="Chinese Transliteration Quick Button" description="Show the pinyin/jyutping toggle in lyrics controls when Chinese lyrics are detected.">
          <Toggle checked={showChineseTranslitButton} onChange={(v) => $showChineseTranslitButton.set(v)} />
        </Row>
      )}

      {showTranslationTarget && (
        <Row label="Translation Target Language" description="Language used for lyrics translation.">
          <Select
            value={translationTargetLang}
            options={optionValues(TRANSLATION_TARGETS)}
            labels={optionLabels(TRANSLATION_TARGETS)}
            onChange={(v) => $translationTargetLang.set(v)}
          />
        </Row>
      )}

      {showCopyFormat && (
        <Row label="Copy Lyrics Format" description="Choose what the lyrics copy button writes to clipboard.">
          <Select
            value={lyricsCopyFormat}
            options={optionValues(LYRICS_COPY_FORMAT_OPTIONS)}
            labels={optionLabels(LYRICS_COPY_FORMAT_OPTIONS)}
            onChange={(v) => $lyricsCopyFormat.set(v as "plain" | "timestamps" | "translation" | "metadata")}
          />
        </Row>
      )}
    </>
  );
}
