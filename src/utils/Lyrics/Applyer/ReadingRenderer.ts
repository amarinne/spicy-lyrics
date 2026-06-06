/**
 * DOM renderer for lyric sidecar text: Japanese furigana, romaji, translation.
 *
 * Applyers own timing/animation registration. This module owns only display
 * decisions and stable markup so furigana does not leak into every renderer.
 */

import { $japaneseReadingMode } from "../../uiState.ts";
import { isMeaningfullyDifferent } from "../TextCompare.ts";
import {
  JapaneseKanaTextTest,
  type FuriganaSegment,
  type JapaneseReadable,
  type JapaneseReading,
} from "../Reading/JapaneseReading.ts";

export type ReadingRenderOptions = {
  useRomanized: boolean;
  romanizationPending?: boolean;
  translationPending?: boolean;
  isJapaneseLyrics?: boolean;
  oppositeAligned?: boolean;
  reserveFurigana?: boolean;
};

type SyllableLike = JapaneseReadable & {
  IsPartOfWord?: boolean;
  RomajiSpaceBefore?: boolean;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function getJapaneseReading(entry: JapaneseReadable | undefined): JapaneseReading | undefined {
  return entry?.JapaneseReading;
}

export function hasFurigana(entry: JapaneseReadable | undefined): boolean {
  return (getJapaneseReading(entry)?.furigana.length || 0) > 0;
}

export function isJapaneseEntry(entry: JapaneseReadable | undefined, isJapaneseLyrics?: boolean): boolean {
  if (!entry) return !!isJapaneseLyrics;
  return !!isJapaneseLyrics || !!entry.JapaneseReading || JapaneseKanaTextTest.test(entry.Text || "");
}

export function shouldRenderFurigana(entry: JapaneseReadable | undefined, options: ReadingRenderOptions): boolean {
  return options.useRomanized && $japaneseReadingMode.get() !== "romaji" && hasFurigana(entry);
}

export function shouldRenderRomanization(entry: JapaneseReadable | undefined, options: ReadingRenderOptions): boolean {
  if (!options.useRomanized) return false;
  const isJapanese = isJapaneseEntry(entry, options.isJapaneseLyrics);
  return !isJapanese || $japaneseReadingMode.get() !== "furigana";
}

function appendPlainText(parent: HTMLElement, text: string): void {
  if (!text) return;

  const cluster = document.createElement("span");
  cluster.className = "furigana-cluster furigana-plain-cluster";

  const reading = document.createElement("span");
  reading.className = "furigana-reading furigana-placeholder";
  reading.textContent = "\u00a0";

  const base = document.createElement("span");
  base.className = "furigana-base";
  base.textContent = text;

  cluster.append(reading, base);
  parent.appendChild(cluster);
}

export function appendFuriganaText(parent: HTMLElement, text: string, rawSegments: FuriganaSegment[]): void {
  parent.textContent = "";

  const segments = [...rawSegments]
    .map((segment) => ({
      start: clamp(segment.start, 0, text.length),
      end: clamp(Math.max(segment.end, segment.start + 1), 0, text.length),
      reading: segment.reading,
    }))
    .filter((segment) => segment.reading && segment.start < segment.end)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  let cursor = 0;
  for (const segment of segments) {
    if (segment.start < cursor) continue;
    appendPlainText(parent, text.slice(cursor, segment.start));

    const cluster = document.createElement("span");
    cluster.className = "furigana-cluster";

    const reading = document.createElement("span");
    reading.className = "furigana-reading";
    reading.textContent = segment.reading;

    const base = document.createElement("span");
    base.className = "furigana-base";
    base.textContent = text.slice(segment.start, segment.end);

    cluster.append(reading, base);
    parent.appendChild(cluster);
    cursor = segment.end;
  }

  appendPlainText(parent, text.slice(cursor));
}

export function renderBaseTextWithReadings(
  element: HTMLElement,
  entry: JapaneseReadable,
  options: ReadingRenderOptions
): boolean {
  const text = entry.Text || "";
  const reading = getJapaneseReading(entry);

  if (shouldRenderFurigana(entry, options) && reading) {
    element.classList.add("has-furigana");
    appendFuriganaText(element, text, reading.furigana);
    return true;
  }

  if (
    options.useRomanized &&
    $japaneseReadingMode.get() !== "romaji" &&
    options.reserveFurigana &&
    isJapaneseEntry(entry, options.isJapaneseLyrics)
  ) {
    element.classList.add("has-furigana");
    appendPlainText(element, text);
    return true;
  }

  if (
    options.useRomanized &&
    $japaneseReadingMode.get() !== "romaji" &&
    options.romanizationPending &&
    isJapaneseEntry(entry, options.isJapaneseLyrics)
  ) {
    element.classList.add("furigana-pending");
  }

  element.textContent = text;
  return false;
}

export function forceStackedLine(lineElem: HTMLElement, oppositeAligned?: boolean): void {
  lineElem.classList.add("HasExtras");
  lineElem.classList.toggle("HasOppositeAlignedExtras", oppositeAligned === true);
}

export function getRomanizedText(entry: JapaneseReadable | undefined): string | undefined {
  if (!entry) return undefined;
  return entry.RomanizedText || entry.TransliteratedText || entry.JapaneseReading?.romaji;
}

export function appendRomanizedBelow(
  lineElem: HTMLElement,
  entry: JapaneseReadable,
  options: ReadingRenderOptions
): boolean {
  if (!shouldRenderRomanization(entry, options)) return false;

  const sourceText = entry.Text || "";
  const romanizedText = getRomanizedText(entry);
  const hasDistinctRomanization = isMeaningfullyDifferent(romanizedText, sourceText);
  if (!hasDistinctRomanization && !options.romanizationPending) return false;

  forceStackedLine(lineElem, options.oppositeAligned);
  const romanizedElem = document.createElement("div");
  romanizedElem.className = `romanized-below${options.romanizationPending && !hasDistinctRomanization ? " romanization-placeholder" : ""}`;
  romanizedElem.textContent = hasDistinctRomanization ? romanizedText! : "";
  lineElem.appendChild(romanizedElem);
  return true;
}

export function appendTranslatedBelow(
  lineElem: HTMLElement,
  sourceText: string,
  translatedText: string | undefined,
  options: ReadingRenderOptions
): boolean {
  const hasDistinctTranslation = isMeaningfullyDifferent(translatedText, sourceText);
  if (!hasDistinctTranslation && !options.translationPending) return false;

  forceStackedLine(lineElem, options.oppositeAligned);
  const translatedElem = document.createElement("div");
  translatedElem.className = `translated-below${options.translationPending && !hasDistinctTranslation ? " translation-placeholder" : ""}`;
  translatedElem.textContent = hasDistinctTranslation ? translatedText! : "";
  lineElem.appendChild(translatedElem);
  return true;
}

export function appendLineExtras(
  lineElem: HTMLElement,
  entry: JapaneseReadable & { TranslatedText?: string },
  options: ReadingRenderOptions
): void {
  appendRomanizedBelow(lineElem, entry, options);
  appendTranslatedBelow(lineElem, entry.Text || "", entry.TranslatedText, options);
}

export function appendSyllableRomanizedBelow(
  lineElem: HTMLElement,
  syllables: SyllableLike[],
  sourceText: string,
  groupRomanizedText: string | undefined,
  groupTranslatedText: string | undefined,
  animatorEntries: Array<{ RomajiElement?: HTMLElement }> | undefined,
  options: ReadingRenderOptions
): void {
  const groupEntry: JapaneseReadable = {
    Text: sourceText,
    RomanizedText: groupRomanizedText,
    TransliteratedText: groupRomanizedText,
    JapaneseReading: syllables.find((s) => s.JapaneseReading)?.JapaneseReading,
  };

  if (shouldRenderRomanization(groupEntry, options)) {
    const hasDistinctRomanization = isMeaningfullyDifferent(groupRomanizedText, sourceText);
    if (hasDistinctRomanization || options.romanizationPending) {
      forceStackedLine(lineElem, options.oppositeAligned);
      const romanizedDiv = document.createElement("div");
      romanizedDiv.className = "romanized-below";

      if (options.romanizationPending && !hasDistinctRomanization) {
        romanizedDiv.classList.add("romanization-placeholder");
      } else if (syllables.some((s) => getRomanizedText(s))) {
        syllables.forEach((syl, index) => {
          const romaji = getRomanizedText(syl);
          if (!isMeaningfullyDifferent(romaji, syl.Text)) return;

          const romajiSpan = document.createElement("span");
          romajiSpan.textContent = romaji;
          romajiSpan.className = "romanized-syllable";
          if (syl.RomajiSpaceBefore || (!syl.IsPartOfWord && index > 0)) {
            romajiSpan.style.marginLeft = "0.25em";
          }
          romanizedDiv.appendChild(romajiSpan);
          if (animatorEntries?.[index]) animatorEntries[index].RomajiElement = romajiSpan;
        });
      } else {
        romanizedDiv.textContent = groupRomanizedText || "";
      }

      lineElem.appendChild(romanizedDiv);
    }
  }

  appendTranslatedBelow(lineElem, sourceText, groupTranslatedText, options);
}
