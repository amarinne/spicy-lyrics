import type { TextRange } from "./Model.ts";

export const codePoints = (text: string): string[] => Array.from(text);

export const codePointLength = (text: string): number => codePoints(text).length;

export const codePointSlice = (text: string, range: TextRange): string =>
  codePoints(text).slice(range.startCp, range.endCp).join("");

export function isValidCodePointRange(text: string, range: TextRange): boolean {
  const length = codePointLength(text);
  return range.startCp >= 0 && range.endCp >= range.startCp && range.endCp <= length;
}

export function utf16IndexToCodePointOffset(text: string, utf16Index: number): number {
  return codePointLength(text.slice(0, Math.max(0, utf16Index)));
}

export function codePointOffsetToUtf16Index(text: string, offsetCp: number): number {
  return codePoints(text).slice(0, Math.max(0, offsetCp)).join("").length;
}
