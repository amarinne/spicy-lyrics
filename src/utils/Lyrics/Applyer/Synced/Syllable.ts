import { $adaptiveSectioning, $fixHanGlyphVariants, $lyricsContainerExists, $minimalLyricsMode, $simpleLyricsMode } from "../../../../utils/stores.ts";
import { PageContainer } from "../../../../components/Pages/PageView.ts";
import { applyStyles, removeAllStyles } from "../../../CSS/Styles.ts";
import {
  ClearScrollSimplebar,
  MountScrollSimplebar,
  RecalculateScrollSimplebar,
  ScrollSimplebar,
} from "../../../Scrolling/Simplebar/ScrollSimplebar.ts";
import { IdleEmphasisLyricsScale, IdleLyricsScale } from "../../Animator/Shared.ts";
import { ConvertTime } from "../../ConvertTime.ts";
import { ClearLyricsPageContainer } from "../../fetchLyrics.ts";
import isRtl from "../../isRtl.ts";
import {
  ClearLyricsContentArrays,
  CurrentLineLyricsObject,
  LyricsObject,
  SetWordArrayInCurentLine,
  getInterludeTimePadding,
  getLyricsBetweenShow,
  setRomanizedStatus,
} from "../../lyrics.ts";
import { CreateLyricsContainer, DestroyAllLyricsContainers } from "../CreateLyricsContainer.ts";
import { initLyricsVirtualizer } from "../../LyricsVirtualizer.ts";
import { ApplyIsByCommunity } from "../Credits/ApplyIsByCommunity.tsx";
import { ApplyLyricsCredits } from "../Credits/ApplyLyricsCredits.ts";
import { EmitApply, EmitNotApplyed } from "../OnApply.ts";
import Emphasize from "../Utils/Emphasize.ts";
import { IsLetterCapable } from "../Utils/IsLetterCapable.ts";
import StripZeroWidth from "../Utils/StripZeroWidth.ts";
import { ApplyLyricsProvider } from "../Credits/ApplyProvider.ts";
import {
  appendSyllableRomanizedBelow,
  hasFuriganaCrossingTimedUnits,
  isJapaneseEntry,
  renderBaseTextWithReadings,
  shouldRenderFurigana,
} from "../ReadingRenderer.ts";
import type { ReadingRenderOptions } from "../ReadingRenderer.ts";
import type { TimedSyllableEntry, TimedSyllableGroup } from "../../Reading/JapaneseReading.ts";
import { timedLogicalGroupIds } from "../../Processing/Japanese/TimedGroupIds.ts";
import {
  applyHanLanguageTag,
  createHanLanguageContext,
  resolveHanLanguageTagForContext,
} from "../../HanLanguage.ts";

// Define the data structure for syllable lyrics
type SyllableData = TimedSyllableEntry;
type LeadData = TimedSyllableGroup;
type BackgroundData = TimedSyllableGroup;

interface LineData {
  Lead: LeadData;
  Background?: BackgroundData[];
  OppositeAligned?: boolean;
}

interface LyricsData {
  Type: string;
  Content: LineData[];
  StartTime: number;
  SongWriters?: string[];
  source?: "spt" | "spl" | "aml";
  classes?: string;
  styles?: Record<string, string>;
}

const joinSyllableDisplayText = (syllables: SyllableData[]): string => {
  return syllables.reduce((acc, syl, index) => {
    const text = syl.Text || "";
    if (index === 0) return text;
    return `${acc}${syllables[index - 1]?.BoundaryAfter === true ? " " : ""}${text}`;
  }, "").trim();
};

const applyWordPositionClasses = (
  element: HTMLElement,
  syllable: SyllableData,
  index: number,
  all: SyllableData[]
): void => {
  if (index === all.length - 1) {
    element.classList.add("LastWordInLine");
  } else if (syllable.BoundaryAfter !== true) {
    element.classList.add("PartOfWord");
  }
};

const registerSyllableWord = (
  element: HTMLElement,
  syllable: SyllableData,
  totalDuration: number,
  isBackground: boolean
): void => {
  const lead = LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject]?.Syllables?.Lead;
  if (!lead) {
    console.warn("Syllables.Lead is undefined for CurrentLineLyricsObject");
    return;
  }

  lead.push({
    HTMLElement: element,
    StartTime: ConvertTime(syllable.StartTime),
    EndTime: ConvertTime(syllable.EndTime),
    TotalTime: totalDuration,
    ...(isBackground ? { BGWord: true } : {}),
  });
};

const createSyllableWord = (
  syllable: SyllableData,
  index: number,
  all: SyllableData[],
  renderOptions: ReadingRenderOptions,
  useRomanized: boolean,
  isBackground: boolean = false
): HTMLElement => {
  let word = document.createElement("span");
  const totalDuration = ConvertTime(syllable.EndTime) - ConvertTime(syllable.StartTime);
  // Render-only: strip invisible markers before the letter-capable count/split
  // so they never receive letter timing slots. Source text stays untouched.
  const renderText = StripZeroWidth(syllable.Text || "");
  const letterLength = renderText.split("").length;
  const hasFurigana = shouldRenderFurigana(syllable, renderOptions);
  const reservesFuriganaRow = hasFurigana || (renderOptions.reserveFurigana === true && useRomanized);
  // Package-backed Japanese words need a registered word element in every
  // display mode. Letter emphasis returns before timing registration.
  const letterCapable = renderText.length > 0
    && IsLetterCapable(letterLength, totalDuration)
    && !isRtl(renderText)
    && !reservesFuriganaRow
    && !syllable.JapaneseReading;
  const sizeVar = isBackground ? "var(--font-size)" : "var(--DefaultLyricsSize)";
  const wordLanguage = resolveHanLanguageTagForContext(syllable.Text, renderOptions.hanLanguageContext);
  if (wordLanguage) word.lang = wordLanguage;

  if (letterCapable) {
    word = document.createElement("div");
    if (wordLanguage) word.lang = wordLanguage;
    Emphasize(renderText.split(""), word, syllable, isBackground);
    applyWordPositionClasses(word, syllable, index, all);

    if (!$simpleLyricsMode.get()) {
      word.style.setProperty("--text-shadow-opacity", `0%`);
      word.style.setProperty("--text-shadow-blur-radius", `4px`);
      word.style.scale = IdleEmphasisLyricsScale.toString();
      word.style.transform = `translateY(calc(${sizeVar} * 0.02))`;
    }

    return word;
  }

  renderBaseTextWithReadings(word, syllable, renderOptions);

  if (!$simpleLyricsMode.get()) {
    word.style.setProperty("--gradient-position", isBackground ? `0%` : `-40%`);
    word.style.setProperty("--text-shadow-opacity", `0%`);
    word.style.setProperty("--text-shadow-blur-radius", `4px`);
    word.style.scale = IdleLyricsScale.toString();
    word.style.transform = `translateY(calc(${sizeVar} * 0.01))`;
  }

  if (isBackground) word.classList.add("bg-word");
  word.classList.add("word");
  applyWordPositionClasses(word, syllable, index, all);
  registerSyllableWord(word, syllable, totalDuration, isBackground);
  return word;
};

const createLineLevelJapaneseWord = (
  group: TimedSyllableGroup,
  sourceText: string,
  renderOptions: ReadingRenderOptions,
  isBackground: boolean = false
): HTMLElement => {
  const word = document.createElement("span");
  const totalDuration = ConvertTime(group.EndTime) - ConvertTime(group.StartTime);
  const sizeVar = isBackground ? "var(--font-size)" : "var(--DefaultLyricsSize)";
  renderBaseTextWithReadings(word, { ...group, Text: sourceText }, renderOptions);

  if (!$simpleLyricsMode.get()) {
    word.style.setProperty("--gradient-position", isBackground ? "0%" : "-40%");
    word.style.setProperty("--text-shadow-opacity", "0%");
    word.style.setProperty("--text-shadow-blur-radius", "4px");
    word.style.scale = IdleLyricsScale.toString();
    word.style.transform = `translateY(calc(${sizeVar} * 0.01))`;
  }

  if (isBackground) word.classList.add("bg-word");
  word.classList.add("word", "line-level-japanese-word");
  registerSyllableWord(word, { Text: sourceText, StartTime: group.StartTime, EndTime: group.EndTime }, totalDuration, isBackground);
  return word;
};

const appendGroupedWord = (
  lineElement: HTMLElement,
  word: HTMLElement,
  syllable: SyllableData,
  currentGroup: HTMLSpanElement | null
): HTMLSpanElement | null => {
  if (currentGroup) {
    currentGroup.appendChild(word);
    return syllable.BoundaryAfter === true ? null : currentGroup;
  }
  if (syllable.BoundaryAfter !== true) {
    const group = document.createElement("span");
    group.classList.add("word-group");
    lineElement.appendChild(group);
    group.appendChild(word);
    return group;
  }

  lineElement.appendChild(word);
  return null;
};

export function ApplySyllableLyrics(data: LyricsData, UseRomanized: boolean = false): void {
  if (!$lyricsContainerExists.get()) return;
  EmitNotApplyed();

  DestroyAllLyricsContainers();
  const LyricsContainerParent = PageContainer?.querySelector<HTMLElement>(
    ".LyricsContainer .LyricsContent"
  );
  const LyricsContainerInstance = CreateLyricsContainer();
  const LyricsContainer = LyricsContainerInstance.Container;

  // Check if LyricsContainer exists
  if (!LyricsContainer) {
    console.error("LyricsContainer not found");
    return;
  }

  const hasOppositeAligned = data.Content.some(item => item.OppositeAligned === true);
  LyricsContainer.classList.toggle("HasDuetLines", hasOppositeAligned);
  const hasRtlLines = data.Content.some(line =>
    line.Lead.Syllables.some(syllable => isRtl(syllable.Text)) ||
    line.Background?.some(bg => bg.Syllables.some(syllable => isRtl(syllable.Text))) === true
  );
  LyricsContainer.classList.toggle("HasRtlLines", hasRtlLines);

  LyricsContainer.setAttribute("data-lyrics-type", "Syllable");

  ClearLyricsContentArrays();
  ClearScrollSimplebar();

  ClearLyricsPageContainer();

  const virtualContainer = document.createElement("div");
  virtualContainer.classList.add("VirtualLyricsContainer");
  LyricsContainer.appendChild(virtualContainer);

  const lineElements: HTMLElement[] = [];

  if (data.StartTime >= getLyricsBetweenShow()) {
    const musicalLine = document.createElement("div");
    musicalLine.classList.add("line");
    musicalLine.classList.add("musical-line");
    LyricsObject.Types.Syllable.Lines.push({
      HTMLElement: musicalLine,
      StartTime: 0,
      EndTime: ConvertTime(data.StartTime),
      TotalTime: ConvertTime(data.StartTime),
      DotLine: true,
    });

    SetWordArrayInCurentLine();

    if (data.Content[0].OppositeAligned) {
      musicalLine.classList.add("OppositeAligned");
    }

    const dotGroup = document.createElement("div");
    dotGroup.classList.add("dotGroup");

    const musicalDots1 = document.createElement("span");
    const musicalDots2 = document.createElement("span");
    const musicalDots3 = document.createElement("span");

    const totalTime = ConvertTime(data.StartTime);
    const baseDotTime = totalTime / 3;
    const dotPadding = getInterludeTimePadding() / 3;
    const dot1EndTime = Math.max(0, baseDotTime + dotPadding);
    const dot2EndTime = Math.max(dot1EndTime, baseDotTime * 2 + dotPadding * 2);
    const dot3EndTime = Math.max(dot2EndTime, totalTime + getInterludeTimePadding());

    musicalDots1.classList.add("word");
    musicalDots1.classList.add("dot");
    musicalDots1.textContent = "•";

    // Check if Syllables.Lead exists
    if (LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject]?.Syllables?.Lead) {
      LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject].Syllables?.Lead.push({
        HTMLElement: musicalDots1,
        StartTime: 0,
        EndTime: dot1EndTime,
        TotalTime: dot1EndTime,
        Dot: true,
      });
    } else {
      console.warn("Syllables.Lead is undefined for CurrentLineLyricsObject");
    }

    musicalDots2.classList.add("word");
    musicalDots2.classList.add("dot");
    musicalDots2.textContent = "•";

    // Check if Syllables.Lead exists
    if (LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject]?.Syllables?.Lead) {
      LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject].Syllables?.Lead.push({
        HTMLElement: musicalDots2,
        StartTime: dot1EndTime,
        EndTime: dot2EndTime,
        TotalTime: dot2EndTime - dot1EndTime,
        Dot: true,
      });
    } else {
      console.warn("Syllables.Lead is undefined for CurrentLineLyricsObject");
    }

    musicalDots3.classList.add("word");
    musicalDots3.classList.add("dot");
    musicalDots3.textContent = "•";

    // Check if Syllables.Lead exists
    if (LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject]?.Syllables?.Lead) {
      LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject].Syllables?.Lead.push({
        HTMLElement: musicalDots3,
        StartTime: dot2EndTime,
        EndTime: dot3EndTime,
        TotalTime: dot3EndTime - dot2EndTime,
        Dot: true,
      });
    } else {
      console.warn("Syllables.Lead is undefined for CurrentLineLyricsObject");
    }

    dotGroup.appendChild(musicalDots1);
    dotGroup.appendChild(musicalDots2);
    dotGroup.appendChild(musicalDots3);

    musicalLine.appendChild(dotGroup);
    lineElements.push(musicalLine);
  }
  const translationPending = (data as any).TranslationPending === true;
  const romanizationPending = (data as any).RomanizationPending === true;
  const isJapaneseLyrics =
    (data as any).Language === "jpn" ||
    data.Content.some((line) =>
      line.Lead.Syllables.some((s) => isJapaneseEntry(s)) ||
      line.Background?.some((bg) => bg.Syllables.some((s) => isJapaneseEntry(s))) === true
    );
  const adaptiveSectioning = $adaptiveSectioning.get();
  const fixHanGlyphVariants = $fixHanGlyphVariants.get();
  data.Content.forEach((line, index, arr) => {
    const lineElem = document.createElement("div");
    lineElem.classList.add("line");
    const leadSourceText = line.Lead.JapaneseReading?.sourceText || joinSyllableDisplayText(line.Lead.Syllables);
    const primaryScript = line.Lead.JapaneseReading ||
      line.Lead.Syllables.some((syllable) => isJapaneseEntry(syllable)) ||
      (data as any).Language === "jpn"
      ? "Japanese" as const
      : (data as any).DetectedChinese ? "Chinese" as const : undefined;
    const hanLanguageContext = createHanLanguageContext(
      data,
      leadSourceText,
      fixHanGlyphVariants,
      primaryScript,
    );
    applyHanLanguageTag(lineElem, hanLanguageContext);
    const lineRenderOptions = {
      useRomanized: UseRomanized,
      romanizationPending,
      translationPending,
      isJapaneseLyrics,
      oppositeAligned: line.OppositeAligned,
      hanLanguageContext,
    };

    const nextLineStartTime = arr[index + 1]?.Lead.StartTime ?? 0;

    const lineEndTimeAndNextLineStartTimeDistance =
      nextLineStartTime !== 0 ? nextLineStartTime - line.Lead.EndTime : 0;

    const lineEndTime =
      $minimalLyricsMode.get()
        ? nextLineStartTime === 0
          ? line.Lead.EndTime
          : lineEndTimeAndNextLineStartTimeDistance < getLyricsBetweenShow() &&
              nextLineStartTime > line.Lead.EndTime
            ? nextLineStartTime
            : line.Lead.EndTime
        : line.Lead.EndTime;

    LyricsObject.Types.Syllable.Lines.push({
      HTMLElement: lineElem,
      StartTime: ConvertTime(line.Lead.StartTime),
      EndTime: ConvertTime(lineEndTime),
      TotalTime: ConvertTime(lineEndTime) - ConvertTime(line.Lead.StartTime),
    });

    SetWordArrayInCurentLine();

    if (line.OppositeAligned) {
      lineElem.classList.add("OppositeAligned");
    }

    lineElements.push(lineElem);

    let currentWordGroup: HTMLSpanElement | null = null;
    let currentSemanticGroupId: string | undefined;
    const leadHasFurigana = shouldRenderFurigana(line.Lead, lineRenderOptions) || line.Lead.Syllables.some((s) => shouldRenderFurigana(s, lineRenderOptions));
    const leadUsesSemanticGroups = adaptiveSectioning && line.Lead.Syllables.some((s) => !!s.JapaneseReading) && !!line.Lead.ReadingRenderPlan;
    const leadRenderOptions = { ...lineRenderOptions, reserveFurigana: leadHasFurigana };
    const leadFuriganaCrossesTiming = leadHasFurigana && hasFuriganaCrossingTimedUnits(line.Lead.ReadingRenderPlan);
    const leadLogicalGroupIds = timedLogicalGroupIds(line.Lead.ReadingRenderPlan);

    if (leadFuriganaCrossesTiming) {
      lineElem.appendChild(createLineLevelJapaneseWord(line.Lead, leadSourceText, leadRenderOptions));
    } else line.Lead.Syllables.forEach((lead, iL, aL) => {
      if (isRtl(lead.Text) && !lineElem.classList.contains("rtl")) {
        lineElem.classList.add("rtl");
      }

      const word = createSyllableWord(lead, iL, aL, leadRenderOptions, UseRomanized);
      const semanticGroupId = leadLogicalGroupIds.get(String(iL));
      if (leadUsesSemanticGroups && semanticGroupId) {
        if (!currentWordGroup || semanticGroupId !== currentSemanticGroupId) {
          currentWordGroup = document.createElement("span");
          currentWordGroup.classList.add("word-group", "semantic-word-group");
          lineElem.appendChild(currentWordGroup);
          currentSemanticGroupId = semanticGroupId;
        }
        currentWordGroup.appendChild(word);
      } else {
        currentWordGroup = appendGroupedWord(lineElem, word, lead, currentWordGroup);
      }
    });

    const leadRomanizedText = line.Lead.RomanizedText || line.Lead.TransliteratedText;
    const leadEntries = LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject]?.Syllables?.Lead;
    appendSyllableRomanizedBelow(
      lineElem,
      line.Lead.Syllables,
      leadSourceText,
      leadRomanizedText,
      line.Lead.TranslatedText,
      leadEntries,
      line.Lead.ReadingRenderPlan,
      lineRenderOptions
    );

    if (line.Background) {
      line.Background.forEach((bg) => {
        const lineE = document.createElement("div");
        lineE.classList.add("line", "bg-line");
        const bgSourceText = bg.JapaneseReading?.sourceText || joinSyllableDisplayText(bg.Syllables);
        const bgPrimaryScript = bg.JapaneseReading ||
          bg.Syllables.some((syllable) => isJapaneseEntry(syllable)) ||
          (data as any).Language === "jpn"
          ? "Japanese" as const
          : (data as any).DetectedChinese ? "Chinese" as const : undefined;
        const bgHanLanguageContext = createHanLanguageContext(
          data,
          bgSourceText,
          fixHanGlyphVariants,
          bgPrimaryScript,
        );
        applyHanLanguageTag(lineE, bgHanLanguageContext);
        const bgRenderOptions = {
          ...lineRenderOptions,
          oppositeAligned: line.OppositeAligned,
          hanLanguageContext: bgHanLanguageContext,
        };

        LyricsObject.Types.Syllable.Lines.push({
          HTMLElement: lineE,
          StartTime: ConvertTime(bg.StartTime),
          EndTime: ConvertTime(bg.EndTime),
          TotalTime: ConvertTime(bg.EndTime) - ConvertTime(bg.StartTime),
          BGLine: true,
        });
        SetWordArrayInCurentLine();

        if (line.OppositeAligned) {
          lineE.classList.add("OppositeAligned");
        }
        lineElements.push(lineE);

        let currentBGWordGroup: HTMLSpanElement | null = null;
        let currentBGSemanticGroupId: string | undefined;
        const bgHasFurigana = shouldRenderFurigana(bg, bgRenderOptions) || bg.Syllables.some((s) => shouldRenderFurigana(s, bgRenderOptions));
        const bgUsesSemanticGroups = adaptiveSectioning && bg.Syllables.some((s) => !!s.JapaneseReading) && !!bg.ReadingRenderPlan;
        const bgWordRenderOptions = { ...bgRenderOptions, reserveFurigana: bgHasFurigana };
        const bgFuriganaCrossesTiming = bgHasFurigana && hasFuriganaCrossingTimedUnits(bg.ReadingRenderPlan);
        const bgLogicalGroupIds = timedLogicalGroupIds(bg.ReadingRenderPlan);

        if (bgFuriganaCrossesTiming) {
          lineE.appendChild(createLineLevelJapaneseWord(bg, bgSourceText, bgWordRenderOptions, true));
        } else bg.Syllables.forEach((bw, bI, bA) => {
          if (isRtl(bw.Text) && !lineE.classList.contains("rtl")) {
            lineE.classList.add("rtl");
          }

          const word = createSyllableWord(bw, bI, bA, bgWordRenderOptions, UseRomanized, true);
          const semanticGroupId = bgLogicalGroupIds.get(String(bI));
          if (bgUsesSemanticGroups && semanticGroupId) {
            if (!currentBGWordGroup || semanticGroupId !== currentBGSemanticGroupId) {
              currentBGWordGroup = document.createElement("span");
              currentBGWordGroup.classList.add("word-group", "semantic-word-group");
              lineE.appendChild(currentBGWordGroup);
              currentBGSemanticGroupId = semanticGroupId;
            }
            currentBGWordGroup.appendChild(word);
          } else {
            currentBGWordGroup = appendGroupedWord(lineE, word, bw, currentBGWordGroup);
          }
        });

        const bgRomanizedText = bg.RomanizedText || bg.TransliteratedText;
        const allEntries = LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject]?.Syllables?.Lead || [];
        const bgEntries = allEntries.filter((entry: any) => entry.BGWord);
        appendSyllableRomanizedBelow(
          lineE,
          bg.Syllables,
          bgSourceText,
          bgRomanizedText,
          bg.TranslatedText,
          bgEntries,
          bg.ReadingRenderPlan,
          bgRenderOptions
        );
      });
    }
    if (arr[index + 1] && arr[index + 1].Lead.StartTime - line.Lead.EndTime >= getLyricsBetweenShow()) {
      const musicalLine = document.createElement("div");
      musicalLine.classList.add("line");
      musicalLine.classList.add("musical-line");

      LyricsObject.Types.Syllable.Lines.push({
        HTMLElement: musicalLine,
        StartTime: ConvertTime(line.Lead.EndTime),
        EndTime: ConvertTime(arr[index + 1].Lead.StartTime),
        TotalTime:
          ConvertTime(arr[index + 1].Lead.StartTime) -
          ConvertTime(line.Lead.EndTime),
        DotLine: true,
      });

      SetWordArrayInCurentLine();

      if (arr[index + 1].OppositeAligned) {
        musicalLine.classList.add("OppositeAligned");
      }

      const dotGroup = document.createElement("div");
      dotGroup.classList.add("dotGroup");

      const musicalDots1 = document.createElement("span");
      const musicalDots2 = document.createElement("span");
      const musicalDots3 = document.createElement("span");

      const gapStartTime = ConvertTime(line.Lead.EndTime);
      const totalTime = ConvertTime(arr[index + 1].Lead.StartTime) - gapStartTime;
      const baseDotTime = totalTime / 3;
      const dotPadding = getInterludeTimePadding() / 3;
      const dot1EndTime = Math.max(gapStartTime, gapStartTime + baseDotTime + dotPadding);
      const dot2EndTime = Math.max(dot1EndTime, gapStartTime + baseDotTime * 2 + dotPadding * 2);
      const dot3EndTime = Math.max(dot2EndTime, gapStartTime + totalTime + getInterludeTimePadding());

      musicalDots1.classList.add("word");
      musicalDots1.classList.add("dot");
      musicalDots1.textContent = "•";

      // Check if Syllables.Lead exists
      if (LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject]?.Syllables?.Lead) {
        LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject].Syllables?.Lead.push({
          HTMLElement: musicalDots1,
          StartTime: gapStartTime,
          EndTime: dot1EndTime,
          TotalTime: dot1EndTime - gapStartTime,
          Dot: true,
        });
      } else {
        console.warn("Syllables.Lead is undefined for CurrentLineLyricsObject");
      }

      musicalDots2.classList.add("word");
      musicalDots2.classList.add("dot");
      musicalDots2.textContent = "•";

      // Check if Syllables.Lead exists
      if (LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject]?.Syllables?.Lead) {
        LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject].Syllables?.Lead.push({
          HTMLElement: musicalDots2,
          StartTime: dot1EndTime,
          EndTime: dot2EndTime,
          TotalTime: dot2EndTime - dot1EndTime,
          Dot: true,
        });
      } else {
        console.warn("Syllables.Lead is undefined for CurrentLineLyricsObject");
      }

      musicalDots3.classList.add("word");
      musicalDots3.classList.add("dot");
      musicalDots3.textContent = "•";

      // Check if Syllables.Lead exists
      if (LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject]?.Syllables?.Lead) {
        LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject].Syllables?.Lead.push({
          HTMLElement: musicalDots3,
          StartTime: dot2EndTime,
          EndTime: dot3EndTime,
          TotalTime: dot3EndTime - dot2EndTime,
          Dot: true,
        });
      } else {
        console.warn("Syllables.Lead is undefined for CurrentLineLyricsObject");
      }

      dotGroup.appendChild(musicalDots1);
      dotGroup.appendChild(musicalDots2);
      dotGroup.appendChild(musicalDots3);

      musicalLine.appendChild(dotGroup);
      lineElements.push(musicalLine);
    }
  });

  ApplyLyricsCredits(data, LyricsContainer);
  ApplyLyricsProvider(data, LyricsContainer);
  ApplyIsByCommunity(data, LyricsContainer);

  if (LyricsContainerParent) {
    LyricsContainerInstance.Append(LyricsContainerParent);
  }

  if (ScrollSimplebar) RecalculateScrollSimplebar();
  else MountScrollSimplebar();

  const scrollEl = ScrollSimplebar?.getScrollElement() as HTMLElement | undefined;
  if (scrollEl) initLyricsVirtualizer(scrollEl, virtualContainer, lineElements);

  const LyricsStylingContainer = PageContainer?.querySelector<HTMLElement>(
    ".LyricsContainer .LyricsContent .simplebar-content"
  );

  // Check if LyricsStylingContainer exists
  if (LyricsStylingContainer) {
    removeAllStyles(LyricsStylingContainer);

    if (data.classes) {
      LyricsStylingContainer.className = data.classes;
    }

    if (data.styles) {
      applyStyles(LyricsStylingContainer, data.styles);
    }
  } else {
    console.warn("LyricsStylingContainer not found");
  }

  EmitApply(data.Type, data.Content);

  setRomanizedStatus(UseRomanized);
}
