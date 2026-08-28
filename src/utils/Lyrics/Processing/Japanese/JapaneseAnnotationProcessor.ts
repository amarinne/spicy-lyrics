import {
  analyzeJapaneseLine,
  applyJapaneseReadingToSyllables,
  type JapaneseReadable,
} from "../../Reading/JapaneseReading.ts";
import { codePointOffsetToUtf16Index, codePointSlice, utf16IndexToCodePointOffset } from "../CodePoint.ts";
import type { CanonicalLine, ReadingAnnotation, ReadingUnit } from "../Model.ts";

function alignUnitTexts(texts: string[], display: string): string[] {
  const out = [...texts];
  let cursor = 0;
  for (let index = 0; index < out.length; index += 1) {
    const text = out[index];
    if (!text) continue;
    const found = display.indexOf(text, cursor);
    if (found < 0) return texts;
    out[index] = `${display.slice(cursor, found)}${text}`;
    cursor = found + text.length;
  }
  if (cursor < display.length) {
    const last = out.findLastIndex(Boolean);
    if (last >= 0) out[last] += display.slice(cursor);
  }
  return out;
}

export async function annotateJapaneseLine(
  canonical: CanonicalLine,
  fullRomaji?: string,
  romajiPromise?: Promise<void>
): Promise<ReadingAnnotation | undefined> {
  const reading = await analyzeJapaneseLine(canonical.text, fullRomaji, romajiPromise);
  if (!reading?.romaji) return undefined;
  const temp: JapaneseReadable[] = canonical.spanMappings.map((mapping) => ({
    Text: codePointSlice(canonical.text, mapping.canonicalRange),
  }));
  const spans = canonical.spanMappings.map((mapping, index) => ({
    index,
    rawText: temp[index].Text || "",
    normalizedText: temp[index].Text || "",
    start: codePointOffsetToUtf16Index(canonical.text, mapping.canonicalRange.startCp),
    end: codePointOffsetToUtf16Index(canonical.text, mapping.canonicalRange.endCp),
  }));
  await applyJapaneseReadingToSyllables(canonical.text, reading.romaji, temp, romajiPromise, spans);
  const aligned = alignUnitTexts(temp.map((entry) => entry.RomanizedText || entry.TransliteratedText ||
    (/\p{Script=Latin}/u.test(entry.Text || "") ? entry.Text || "" : "")), reading.romaji);
  if (!aligned.some(Boolean) && aligned.length > 0) aligned[0] = reading.romaji;
  let group = 0;
  const units: ReadingUnit[] = canonical.spanMappings.map((mapping, index) => {
    if (index > 0 && aligned[index]) group += 1;
    const source = temp[index].Text || "";
    return {
      canonicalRange: mapping.canonicalRange,
      text: aligned[index],
      kind: /[぀-ヿ一-鿿]/u.test(source) ? "transformed" : "passthrough",
      logicalGroupId: `jp-${group}`,
      timingRefs: [mapping.spanId],
    };
  });
  return {
    processor: "Japanese",
    mode: "romaji",
    provenance: "local",
    units,
    furigana: reading.furigana.map((segment) => ({
      canonicalRange: {
        startCp: utf16IndexToCodePointOffset(canonical.text, segment.start),
        endCp: utf16IndexToCodePointOffset(canonical.text, segment.end),
      },
      reading: segment.reading,
      provenance: "local",
    })),
  };
}
