import { useStore } from "@nanostores/react";
import React from "react";
import {
  $minimalLyricsMode,
  $simpleLyricsMode,
  $simpleLyricsModeRenderingType,
} from "../../../utils/stores.ts";
import {
  $chineseTranslitMode,
  $japaneseReadingMode,
  $lyricsCopyFormat,
  $showChineseTranslitButton,
  $translationEnabled,
  $translationTargetLang,
} from "../../../utils/uiState.ts";
import { matches, Row, Select, SectionTitle, Toggle } from "./components.tsx";

const SECTION_NAME = "Lyrics Display";

const SIMPLE_RENDERING_OPTIONS = ["calculate", "animate"];
const CHINESE_TRANSLIT_OPTIONS = ["pinyin", "jyutping"];

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
  const chineseTranslitMode = useStore($chineseTranslitMode);
  const japaneseReadingMode = useStore($japaneseReadingMode);
  const translationEnabled = useStore($translationEnabled);
  const translationTargetLang = useStore($translationTargetLang);
  const lyricsCopyFormat = useStore($lyricsCopyFormat);
  const showChineseTranslitButton = useStore($showChineseTranslitButton);

  if (sectionFilter !== "All" && sectionFilter !== SECTION_NAME) return null;

  const showSimpleLyricsMode = matches(query, "Simple Lyrics Mode", "Remove extra visual effects from lyrics");
  const showSimpleRenderingStyle = matches(query, "Simple Mode: Text Animation Style", "How lyrics text transitions are rendered in Simple Lyrics Mode.");
  const showMinimalLyricsMode = matches(query, "Minimal Lyrics Mode", "Hides sung lyrics lines in Fullscreen and Cinema Mode");
  const showChineseTransliteration = matches(query, "Chinese Transliteration", "Choose Mandarin pinyin or Cantonese jyutping for Chinese lyrics.");
  const showJapaneseReadingDisplay = matches(query, "Japanese Reading Display", "Choose romaji, furigana, or both for Japanese lyrics.");
  const showLyricsTranslation = matches(query, "Lyrics Translation", "Show translated lyrics under each line.");
  const showTranslationTarget = matches(query, "Translation Target Language", "Language used for lyrics translation.");
  const showChineseQuickButton = matches(query, "Chinese Transliteration Quick Button", "Show the pinyin/jyutping toggle in lyrics controls when Chinese lyrics are detected.");
  const showCopyFormat = matches(query, "Copy Lyrics Format", "Choose what the lyrics copy button writes to clipboard.");

  const hasVisibleRows =
    showSimpleLyricsMode ||
    showSimpleRenderingStyle ||
    showMinimalLyricsMode ||
    showChineseTransliteration ||
    showJapaneseReadingDisplay ||
    showLyricsTranslation ||
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

      {showChineseTransliteration && (
        <Row label="Chinese Transliteration" description="Choose Mandarin pinyin or Cantonese jyutping for Chinese lyrics.">
          <Select
            value={chineseTranslitMode}
            options={CHINESE_TRANSLIT_OPTIONS}
            onChange={(v) => $chineseTranslitMode.set(v as "pinyin" | "jyutping")}
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

      {showLyricsTranslation && (
        <Row label="Lyrics Translation" description="Show translated lyrics under each line.">
          <Toggle checked={translationEnabled} onChange={(v) => $translationEnabled.set(v)} />
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
