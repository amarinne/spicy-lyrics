import { useStore } from "@nanostores/react";
import React from "react";
import {
  $googleSoundFallback,
  $simpleLyricsMode,
  $soundBackend,
  $soundTargetOrthography,
  type SoundOrthography,
} from "../../../utils/stores.ts";
import {
  $chineseCharacterForm,
  $chineseReadingPlacement,
  $chineseTones,
  $chineseTranslitMode,
  $cyrillicKeepSigns,
  $cyrillicRomanizationMode,
  $flatViewControls,
  $forceDarkBackground,
  $japaneseReadingMode,
  $joinMandarinWords,
  $koreanDisplayMode,
  $lyricsCopyFormat,
  $prefetchNextLyrics,
  $showChineseTranslitButton,
  $translationEnabled,
  $translationTargetLang,
} from "../../../utils/uiState.ts";
import { $adaptiveSectioning, $fixHanGlyphVariants, $systemFontStack } from "../../../utils/stores.ts";
import { RemoveAIRefinementCache } from "../../../utils/LyricsCacheTools.ts";
import { SPICY_LYRICS_BUILD_MARKER } from "../../../utils/buildMarker.ts";
import { isJyutpingTranslitMode } from "../../../utils/Lyrics/Fork/Romanization.ts";
import AIRefinementSettings from "./AIRefinementSettings.tsx";
import { Select, Toggle } from "./components.tsx";
import type { GroupDef, SectionDef, SettingDef } from "./model.ts";

/**
 * Fork-only settings, kept in one module so upstream section files stay
 * byte-close to upstream: each upstream section spreads one of these group
 * lists into its own. Labels and descriptions are the search text, as in
 * upstream's model.
 */

const CHINESE_TRANSLIT_OPTIONS = [
  { value: "pinyin", label: "Mandarin Pinyin" },
  { value: "pinyin-vn", label: "Mandarin eza式" },
  { value: "jyutping", label: "Cantonese Jyutping" },
  { value: "jyutping-vn", label: "Cantonese eza式" },
] as const;

const KOREAN_OPTIONS = [
  { value: "wordTranslit", label: "Word-by-word transliteration" },
  { value: "rrStandard", label: "Standard Korean RR" },
  { value: "rrPronunciation", label: "Follow pronunciation (RR)" },
  { value: "vnPronunciation", label: "Follow pronunciation (eza式)" },
] as const;

const JAPANESE_OPTIONS = [
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

const COPY_FORMAT_OPTIONS = [
  { value: "plain", label: "Plain lyrics" },
  { value: "timestamps", label: "Lyrics + timestamps" },
  { value: "translation", label: "Lyrics + translation" },
  { value: "transliteration", label: "Lyrics + transliteration" },
  { value: "metadata", label: "Artist/title + lyrics" },
] as const;

const values = <T extends readonly { value: string }[]>(options: T) => options.map(({ value }) => value);
const labels = <T extends readonly { label: string }[]>(options: T) => options.map(({ label }) => label);

export const forkLyricsGroups: GroupDef[] = [
  {
    title: "Reading",
    settings: [
      {
        id: "adaptiveSectioning",
        label: "Adaptive Sectioning",
        description: "Keep Japanese semantic groups together and improve wrapping for reading and translation rows.",
        Control: ({ label }) => (
          <Toggle label={label} checked={useStore($adaptiveSectioning)} onChange={(v) => $adaptiveSectioning.set(v)} />
        ),
      },
      {
        id: "chineseTranslitMode",
        label: "Chinese Transliteration",
        description: "Choose Mandarin pinyin, Cantonese jyutping, or their eza式 spellings.",
        Control: ({ label }) => (
          <Select
            label={label}
            value={useStore($chineseTranslitMode)}
            options={values(CHINESE_TRANSLIT_OPTIONS)}
            labels={labels(CHINESE_TRANSLIT_OPTIONS)}
            onChange={(v) => $chineseTranslitMode.set(v as "pinyin" | "jyutping" | "pinyin-vn" | "jyutping-vn")}
          />
        ),
      },
      {
        id: "chineseCharacterForm",
        label: "Chinese Character Form",
        description: "Keep original characters or convert Chinese lyrics locally.",
        Control: ({ label }) => (
          <Select
            label={label}
            value={useStore($chineseCharacterForm)}
            options={["original", "simplified", "traditional"]}
            labels={["Original", "Simplified", "Traditional"]}
            onChange={(v) => $chineseCharacterForm.set(v as any)}
          />
        ),
      },
      {
        id: "chineseTones",
        label: "Chinese Tones",
        description: "Show Mandarin tone marks and Cantonese jyutping tone numbers (eza式 uses tone marks).",
        Control: ({ label }) => (
          <Toggle label={label} checked={useStore($chineseTones)} onChange={(v) => $chineseTones.set(v)} />
        ),
      },
      {
        id: "chineseReadingPlacement",
        label: "Chinese Reading Placement",
        description: "Put the reading under the line, under each word, or above each word.",
        Control: ({ label }) => (
          <Select
            label={label}
            value={useStore($chineseReadingPlacement)}
            options={["lineBelow", "wordBelow", "wordAbove"]}
            labels={["Under the line", "Under each word", "Above each word"]}
            onChange={(v) => $chineseReadingPlacement.set(v as any)}
          />
        ),
      },
      {
        id: "joinMandarinWords",
        label: "Group Pinyin by Word",
        description: "Keep Pinyin syllables together when they form one detected Mandarin word.",
        useDisabled: () => {
          const mode = useStore($chineseTranslitMode);
          const chineseReadingPlacement = useStore($chineseReadingPlacement);
          if (isJyutpingTranslitMode(mode)) return "Choose a Mandarin mode first.";
          if (chineseReadingPlacement !== "lineBelow") return "Readings already sit on their own words.";
          return false;
        },
        Control: ({ label, disabled }) => (
          <Toggle label={label} checked={useStore($joinMandarinWords)} onChange={(v) => $joinMandarinWords.set(v)} disabled={disabled} />
        ),
      },
      {
        id: "japaneseReadingMode",
        label: "Japanese Reading Display",
        description: "Choose romaji, furigana, or both for Japanese lyrics.",
        Control: ({ label }) => (
          <Select
            label={label}
            value={useStore($japaneseReadingMode)}
            options={values(JAPANESE_OPTIONS)}
            labels={labels(JAPANESE_OPTIONS)}
            onChange={(v) => $japaneseReadingMode.set(v as any)}
          />
        ),
      },
      {
        id: "koreanDisplayMode",
        label: "Korean Display",
        description: "Choose Korean transliteration mode for the extra romanized line.",
        Control: ({ label }) => (
          <Select
            label={label}
            value={useStore($koreanDisplayMode)}
            options={values(KOREAN_OPTIONS)}
            labels={labels(KOREAN_OPTIONS)}
            onChange={(v) => $koreanDisplayMode.set(v as any)}
          />
        ),
      },
      {
        id: "cyrillicRomanizationMode",
        label: "Cyrillic Language",
        description: "Choose Russian or Ukrainian Cyrillic romanization rules.",
        Control: ({ label }) => (
          <Select
            label={label}
            value={useStore($cyrillicRomanizationMode)}
            options={["Russian", "Ukrainian"]}
            onChange={(v) => $cyrillicRomanizationMode.set(v as any)}
          />
        ),
      },
      {
        id: "cyrillicKeepSigns",
        label: "Keep Cyrillic Signs",
        description: "Preserve Cyrillic hard and soft sign marks.",
        Control: ({ label }) => (
          <Toggle label={label} checked={useStore($cyrillicKeepSigns)} onChange={(v) => $cyrillicKeepSigns.set(v)} />
        ),
      },
      {
        id: "showChineseTranslitButton",
        label: "Chinese Transliteration Quick Button",
        description: "Show the pinyin/jyutping toggle in lyrics controls when Chinese lyrics are detected.",
        Control: ({ label }) => (
          <Toggle label={label} checked={useStore($showChineseTranslitButton)} onChange={(v) => $showChineseTranslitButton.set(v)} />
        ),
      },
    ],
  },
  {
    title: "Translation",
    settings: [
      {
        id: "translationEnabled",
        label: "Lyrics Translation",
        description: "Show translated lyrics under each line.",
        Control: ({ label }) => (
          <Toggle label={label} checked={useStore($translationEnabled)} onChange={(v) => $translationEnabled.set(v)} />
        ),
      },
      {
        id: "translationTargetLang",
        label: "Translation Target Language",
        description: "Language used for lyrics translation.",
        Control: ({ label }) => (
          <Select
            label={label}
            value={useStore($translationTargetLang)}
            options={values(TRANSLATION_TARGETS)}
            labels={labels(TRANSLATION_TARGETS)}
            onChange={(v) => $translationTargetLang.set(v)}
          />
        ),
      },
      {
        id: "googleSoundFallback",
        label: "Google Transliteration Fallback",
        description: "Use Google only for lines where the built-in Latin reading path has no output. Lyrics are sent to Google when needed.",
        Control: ({ label }) => (
          <Toggle label={label} checked={useStore($googleSoundFallback)} onChange={(v) => $googleSoundFallback.set(v)} />
        ),
      },
      {
        id: "soundTargetOrthography",
        label: "Target Orthography",
        description: "Choose the script used for AI pronunciation.",
        useDisabled: () => useStore($soundBackend) === "deterministic" && "Choose an AI sound backend first.",
        Control: ({ label, disabled }) => (
          <Select
            label={label}
            value={useStore($soundTargetOrthography)}
            options={["Latin", "Kana", "Hangul", "Cyrillic"]}
            onChange={(v) => $soundTargetOrthography.set(v as SoundOrthography)}
            disabled={disabled}
          />
        ),
      },
      {
        id: "lyricsCopyFormat",
        label: "Copy Lyrics Format",
        description: "Choose what the lyrics copy button writes to the clipboard.",
        Control: ({ label }) => (
          <Select
            label={label}
            value={useStore($lyricsCopyFormat)}
            options={values(COPY_FORMAT_OPTIONS)}
            labels={labels(COPY_FORMAT_OPTIONS)}
            onChange={(v) => $lyricsCopyFormat.set(v as any)}
          />
        ),
      },
    ],
  },
];

export const forkAppearanceGroups: GroupDef[] = [
  {
    title: "Fonts",
    settings: [
      {
        id: "systemFontStack",
        label: "Font Family Stack",
        description: "Comma-separated installed fonts, tried from left to right.",
        keywords: "font family stack",
        useDisabled: () => {
          // The stack only applies with the system font on; the toggle lives in
          // upstream's Text group in this same section.
          return false;
        },
        Control: () => (
          <input
            className="sl-sp-text-input"
            value={useStore($systemFontStack)}
            onChange={(event) => $systemFontStack.set(event.currentTarget.value)}
            placeholder={'"Inter", "Noto Sans JP", "Noto Sans SC", "Noto Sans TC", sans-serif'}
            spellCheck={false}
          />
        ),
      },
      {
        id: "fixHanGlyphVariants",
        label: "Fix Han Glyph Variants",
        description: "Prefer Noto Sans JP, SC, or TC according to each lyric line.",
        keywords: "han glyph variants japanese chinese font",
        Control: ({ label }) => (
          <Toggle label={label} checked={useStore($fixHanGlyphVariants)} onChange={(v) => $fixHanGlyphVariants.set(v)} />
        ),
      },
    ],
  },
];

export const forkInterfaceGroups: GroupDef[] = [
  {
    title: "Controls",
    settings: [
      {
        id: "flatViewControls",
        label: "Flat Controls (No Liquid Glass)",
        description: "Use flat lyrics control buttons instead of liquid-glass buttons.",
        Control: ({ label }) => (
          <Toggle label={label} checked={useStore($flatViewControls)} onChange={(v) => $flatViewControls.set(v)} />
        ),
      },
      {
        id: "prefetchNextLyrics",
        label: "Prefetch Next Lyrics",
        description: "Fetch and process upcoming track lyrics before the song changes.",
        Control: ({ label }) => (
          <Toggle label={label} checked={useStore($prefetchNextLyrics)} onChange={(v) => $prefetchNextLyrics.set(v)} />
        ),
      },
    ],
  },
];

export const forkBackgroundGroups: GroupDef[] = [
  {
    title: "Colour",
    settings: [
      {
        id: "forceDarkBackground",
        label: "Force Dark Background",
        description: "Darken and desaturate bright dynamic background colors.",
        Control: ({ label }) => (
          <Toggle label={label} checked={useStore($forceDarkBackground)} onChange={(v) => $forceDarkBackground.set(v)} />
        ),
      },
    ],
  },
];

export const forkAdvancedGroups: GroupDef[] = [
  {
    title: "Fork",
    settings: [
      {
        id: "clearAIRefinementCache",
        label: "Clear AI Refinement Cache",
        description: "Delete all paid AI refinement results. API keys are kept.",
        keywords: "clear ai refinement cache",
        Control: () => (
          <button type="button" className="sl-sp-btn" onClick={() => RemoveAIRefinementCache(true)}>
            Clear
          </button>
        ),
      },
      {
        id: "buildMarker",
        label: "Build Marker",
        description: SPICY_LYRICS_BUILD_MARKER,
        keywords: "build marker version",
        Control: () => <span className="sl-ai-note">{SPICY_LYRICS_BUILD_MARKER}</span>,
      },
    ],
  },
];

const AIIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 2.5 9.2 5.8 12.5 7 9.2 8.2 8 11.5 6.8 8.2 3.5 7 6.8 5.8Z" />
    <path d="M12.5 10.5v3M11 12h3" />
  </svg>
);

export const aiSection: SectionDef = {
  id: "ai",
  title: "AI Features",
  icon: AIIcon,
  groups: () => [
    {
      settings: [
        {
          id: "aiRefinement",
          label: "AI Features",
          description: "Enable AI translation and pronunciation, configure providers, and choose button behavior.",
          keywords: "provider api key model test connection",
          render: () => <AIRefinementSettings />,
        } satisfies SettingDef,
      ],
    },
  ],
};
