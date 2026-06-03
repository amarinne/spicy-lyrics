import { useStore } from "@nanostores/react";
import React from "react";
import {
  $minimalLyricsMode,
  $simpleLyricsMode,
  $simpleLyricsModeRenderingType,
} from "../../../utils/stores.ts";
import {
  $chineseTranslitMode,
  $showChineseTranslitButton,
  $translationEnabled,
  $translationTargetLang,
} from "../../../utils/uiState.ts";
import { matches, Row, Select, SectionTitle, Toggle } from "./components.tsx";

const SECTION_NAME = "Lyrics Display";
const renderingTypeOptions = ["calculate", "animate"];
const chineseTranslitOptions = ["pinyin", "jyutping"];
const translationTargetOptions = ["en", "es", "fr", "de", "it", "pt", "ja", "ko", "zh-CN", "zh-TW"];

interface Props {
  query: string;
  sectionFilter: string;
}

export default function LyricsSection({ query, sectionFilter }: Props) {
  const simpleLyricsMode = useStore($simpleLyricsMode);
  const simpleLyricsModeRenderingType = useStore($simpleLyricsModeRenderingType);
  const minimalLyricsMode = useStore($minimalLyricsMode);
  const chineseTranslitMode = useStore($chineseTranslitMode);
  const translationEnabled = useStore($translationEnabled);
  const translationTargetLang = useStore($translationTargetLang);
  const showChineseTranslitButton = useStore($showChineseTranslitButton);

  if (sectionFilter !== "All" && sectionFilter !== SECTION_NAME) return null;

  const r1 = matches(query, "Simple Lyrics Mode", "Remove extra visual effects from lyrics");
  const r2 = matches(query, "Simple Mode: Text Animation Style", "How lyrics text transitions are rendered in Simple Lyrics Mode.");
  const r3 = matches(query, "Minimal Lyrics Mode", "Hides sung lyrics lines in Fullscreen and Cinema Mode");
  const r4 = matches(query, "Chinese Transliteration", "Choose Mandarin pinyin or Cantonese jyutping for Chinese lyrics.");
  const r5 = matches(query, "Lyrics Translation", "Show translated lyrics under each line.");
  const r6 = matches(query, "Translation Target Language", "Language used for lyrics translation.");
  const r7 = matches(query, "Chinese Transliteration Quick Button", "Show the pinyin/jyutping toggle in lyrics controls when Chinese lyrics are detected.");

  if (!r1 && !r2 && !r3 && !r4 && !r5 && !r6 && !r7) return null;

  return (
    <>
      <SectionTitle>Lyrics Display</SectionTitle>

      {r1 && (
        <Row label="Simple Lyrics Mode" description="Remove extra visual effects from lyrics">
          <Toggle checked={simpleLyricsMode} onChange={(v) => $simpleLyricsMode.set(v)} />
        </Row>
      )}

      {r2 && (
        <Row
          label="Simple Mode: Text Animation Style"
          description="How lyrics text transitions are rendered in Simple Lyrics Mode."
          disabled={!simpleLyricsMode}
          disabledReason="Enable Simple Lyrics Mode to modify this setting"
        >
          <Select
            value={simpleLyricsModeRenderingType}
            options={renderingTypeOptions}
            onChange={(v) => $simpleLyricsModeRenderingType.set(v)}
            disabled={!simpleLyricsMode}
          />
        </Row>
      )}

      {r3 && (
        <Row
          label="Minimal Lyrics Mode"
          description="Hides sung lyrics lines in Fullscreen and Cinema Mode"
        >
          <Toggle checked={minimalLyricsMode} onChange={(v) => $minimalLyricsMode.set(v)} />
        </Row>
      )}

      {r4 && (
        <Row label="Chinese Transliteration" description="Choose Mandarin pinyin or Cantonese jyutping for Chinese lyrics.">
          <Select
            value={chineseTranslitMode}
            options={chineseTranslitOptions}
            onChange={(v) => $chineseTranslitMode.set(v as "pinyin" | "jyutping")}
          />
        </Row>
      )}

      {r5 && (
        <Row label="Lyrics Translation" description="Show translated lyrics under each line.">
          <Toggle checked={translationEnabled} onChange={(v) => $translationEnabled.set(v)} />
        </Row>
      )}

      {r7 && (
        <Row label="Chinese Transliteration Quick Button" description="Show the pinyin/jyutping toggle in lyrics controls when Chinese lyrics are detected.">
          <Toggle checked={showChineseTranslitButton} onChange={(v) => $showChineseTranslitButton.set(v)} />
        </Row>
      )}

      {r6 && (
        <Row label="Translation Target Language" description="Language used for lyrics translation.">
          <Select
            value={translationTargetLang}
            options={translationTargetOptions}
            onChange={(v) => $translationTargetLang.set(v)}
          />
        </Row>
      )}
    </>
  );
}
