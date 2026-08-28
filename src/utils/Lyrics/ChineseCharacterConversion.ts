import { ConverterBuilder } from "opencc-js/core";
import * as CnToTraditionalPreset from "opencc-js/preset/cn2t";
import * as TraditionalToCnPreset from "opencc-js/preset/t2cn";
import { canonicalTextFromSyllables } from "./Processing/ProviderBoundary.ts";

export type ChineseCharacterForm = "original" | "simplified" | "traditional";
export type DetectedChineseCharacterForm = Exclude<ChineseCharacterForm, "original"> | "ambiguous";

type TimedTextUnit = { Text?: string; IsPartOfWord?: boolean };

const toSimplified = ConverterBuilder(TraditionalToCnPreset)({ from: "t", to: "cn" });
const toTraditional = ConverterBuilder(CnToTraditionalPreset)({ from: "cn", to: "tw" });

const codePoints = (value: string): string[] => Array.from(value);

function differenceCount(left: string, right: string): number {
  const a = codePoints(left);
  const b = codePoints(right);
  const length = Math.max(a.length, b.length);
  let differences = 0;
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) differences += 1;
  }
  return differences;
}

export function convertChineseText(text: string, form: ChineseCharacterForm): string {
  if (!text || form === "original") return text;
  return form === "simplified" ? toSimplified(text) : toTraditional(text);
}

export function detectChineseCharacterForm(text: string): DetectedChineseCharacterForm {
  const simplifiedEvidence = differenceCount(text, toTraditional(text));
  const traditionalEvidence = differenceCount(text, toSimplified(text));
  if (simplifiedEvidence === traditionalEvidence) return "ambiguous";
  return traditionalEvidence > simplifiedEvidence ? "traditional" : "simplified";
}

function alignedOutputBoundaries(source: string, output: string): number[] {
  const from = codePoints(source);
  const to = codePoints(output);
  const costs = Array.from({ length: from.length + 1 }, () => Array<number>(to.length + 1).fill(0));
  for (let index = 0; index <= from.length; index += 1) costs[index][0] = index;
  for (let index = 0; index <= to.length; index += 1) costs[0][index] = index;
  for (let fromIndex = 1; fromIndex <= from.length; fromIndex += 1) {
    for (let toIndex = 1; toIndex <= to.length; toIndex += 1) {
      const substitution = costs[fromIndex - 1][toIndex - 1] + (from[fromIndex - 1] === to[toIndex - 1] ? 0 : 1);
      const deletion = costs[fromIndex - 1][toIndex] + 1;
      const insertion = costs[fromIndex][toIndex - 1] + 1;
      costs[fromIndex][toIndex] = Math.min(substitution, deletion, insertion);
    }
  }

  const reversed: Array<"pair" | "delete" | "insert"> = [];
  let fromIndex = from.length;
  let toIndex = to.length;
  while (fromIndex > 0 || toIndex > 0) {
    const pairCost = fromIndex > 0 && toIndex > 0
      ? costs[fromIndex - 1][toIndex - 1] + (from[fromIndex - 1] === to[toIndex - 1] ? 0 : 1)
      : Number.POSITIVE_INFINITY;
    if (pairCost === costs[fromIndex][toIndex]) {
      reversed.push("pair");
      fromIndex -= 1;
      toIndex -= 1;
    } else if (fromIndex > 0 && costs[fromIndex - 1][toIndex] + 1 === costs[fromIndex][toIndex]) {
      reversed.push("delete");
      fromIndex -= 1;
    } else {
      reversed.push("insert");
      toIndex -= 1;
    }
  }

  const boundaries = Array<number>(from.length + 1).fill(0);
  fromIndex = 0;
  toIndex = 0;
  for (const operation of reversed.reverse()) {
    if (operation === "insert") {
      toIndex += 1;
      continue;
    }
    fromIndex += 1;
    if (operation === "pair") toIndex += 1;
    boundaries[fromIndex] = toIndex;
  }
  boundaries[from.length] = to.length;
  return boundaries;
}

export function convertChineseTimedTextUnits(units: TimedTextUnit[], form: ChineseCharacterForm): string[] {
  if (form === "original" || units.length === 0) return units.map((unit) => unit.Text || "");
  const resolution = canonicalTextFromSyllables(units);
  const source = resolution.canonical.text;
  const output = convertChineseText(source, form);
  const boundaries = alignedOutputBoundaries(source, output);
  const outputPoints = codePoints(output);
  return resolution.canonical.spanMappings.map(({ canonicalRange }) =>
    outputPoints.slice(boundaries[canonicalRange.startCp], boundaries[canonicalRange.endCp]).join("")
  );
}

export function convertChineseLyricsText(
  lyrics: any,
  form: ChineseCharacterForm,
  shouldConvert: (text: string) => boolean,
): void {
  if (form === "original") return;
  const convertTextEntry = (entry: any) => {
    if (typeof entry?.Text === "string" && shouldConvert(entry.Text)) {
      entry.Text = convertChineseText(entry.Text, form);
    }
  };
  const convertTimedGroup = (group: any) => {
    const units = group?.Syllables;
    if (!Array.isArray(units) || units.length === 0) return;
    const resolution = canonicalTextFromSyllables(units);
    if (!shouldConvert(resolution.canonical.text)) return;
    const converted = convertChineseTimedTextUnits(units, form);
    units.forEach((unit: TimedTextUnit, index: number) => { unit.Text = converted[index]; });
  };
  if (lyrics?.Type === "Static") {
    for (const line of lyrics.Lines || []) convertTextEntry(line);
  } else if (lyrics?.Type === "Line") {
    for (const line of lyrics.Content || []) convertTextEntry(line);
  } else if (lyrics?.Type === "Syllable") {
    for (const vocal of lyrics.Content || []) {
      convertTimedGroup(vocal?.Lead);
      for (const background of vocal?.Background || []) convertTimedGroup(background);
    }
  }
}
