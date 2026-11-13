/**
 * Hanyu Pinyin number/mark conversion.
 *
 * Canonical internal form: lowercase letters plus one tone digit, `1`-`5`. Tone `5` is neutral.
 * `ü` stays `ü`; g2pM's ASCII `u:` spelling is canonicalised on input.
 */

const TONE_MARKS: Readonly<Record<number, string>> = { 1: "\u0304", 2: "\u0301", 3: "\u030c", 4: "\u0300" };
const MARK_TO_TONE: Readonly<Record<string, number>> = { "\u0304": 1, "\u0301": 2, "\u030c": 3, "\u0300": 4 };
const VOWELS = new Set(["a", "e", "i", "o", "u", "ü", "ê"]);
const SYLLABIC = new Set(["m", "n", "r"]);
const NUMBERED = /^([a-züê]+)([1-5])$/u;

/** Convert a marked pinyin syllable such as `zhǒng` or `de` to `zhong3` / `de5`. */
export function numberedFromMarked(marked: string): string | undefined {
  let tone = 5;
  const letters: string[] = [];
  for (const char of marked.trim().normalize("NFD").toLowerCase()) {
    const markedTone = MARK_TO_TONE[char];
    if (markedTone !== undefined) {
      tone = markedTone;
    } else {
      letters.push(char);
    }
  }
  const base = letters.join("").normalize("NFC").replaceAll("u:", "ü").replaceAll("v", "ü");
  return NUMBERED.test(`${base}${tone}`) ? `${base}${tone}` : undefined;
}

/** Canonicalise a g2pM class label or a pinyin-data reading. */
export function canonicalNumbered(raw: string): string | undefined {
  const value = raw.trim().toLowerCase().replaceAll("u:", "ü").replaceAll("v", "ü");
  return NUMBERED.test(value) ? value : undefined;
}

export function numberedLetters(raw: string): string {
  const match = NUMBERED.exec(raw);
  return match?.[1] ?? raw.replace(/[1-5]$/u, "");
}

export function numberedTone(raw: string): number {
  const match = NUMBERED.exec(raw);
  return match ? Number(match[2]) : 5;
}

export function isNeutral(raw: string): boolean {
  return numberedTone(raw) === 5;
}

function markVowel(base: string, tone: number): string {
  if (tone === 5) return base;
  const mark = TONE_MARKS[tone];
  if (!mark) return base;

  let at = base.indexOf("a");
  if (at < 0) at = base.indexOf("e");
  if (at < 0 && base.includes("ou")) at = base.indexOf("o");
  if (at < 0) {
    for (let index = base.length - 1; index >= 0; index -= 1) {
      if (VOWELS.has(base[index]!)) {
        at = index;
        break;
      }
    }
  }
  if (at < 0 && base.length === 1 && SYLLABIC.has(base)) at = 0;
  if (at < 0) return `${base}${tone}`;

  // NFD so a tone mark follows the diaeresis in `ü` and composes back to `ǚ`.
  const decomposed = base.normalize("NFD");
  const chars = Array.from(decomposed);
  let sourceIndex = 0;
  for (let index = 0; index < at; index += 1) sourceIndex += base[index] === "ü" ? 2 : 1;
  sourceIndex += base[at] === "ü" ? 1 : 0;
  return `${chars.slice(0, sourceIndex + 1).join("")}${mark}${chars.slice(sourceIndex + 1).join("")}`.normalize("NFC");
}

/** Standard marked Pinyin. Tone 5 is intentionally unmarked. */
export function markedFromNumbered(raw: string): string {
  const match = NUMBERED.exec(raw);
  if (!match) return raw;
  return markVowel(match[1]!, Number(match[2]));
}

/**
 * Full-citation alternative for a selected reading. It is evidence for a later display decision,
 * never the selected Standard Pinyin. Non-neutral readings return themselves. A neutral reading
 * prefers a same-letters full tone, then the first full-tone candidate in source order.
 */
export function citationFromCandidates(raw: string, candidates: readonly string[]): string {
  if (!isNeutral(raw)) return raw;
  const letters = numberedLetters(raw);
  const sameLetters = candidates.find((candidate) => numberedTone(candidate) !== 5 && numberedLetters(candidate) === letters);
  if (sameLetters) return sameLetters;
  return candidates.find((candidate) => numberedTone(candidate) !== 5) ?? raw;
}

/** Deduplicate while preserving source order. */
export function uniqueReadings(readings: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const reading of readings) {
    const canonical = canonicalNumbered(reading);
    if (canonical && !seen.has(canonical)) {
      seen.add(canonical);
      out.push(canonical);
    }
  }
  return out;
}
