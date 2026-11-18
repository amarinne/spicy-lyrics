/**
 * Authored Mandarin Bopomofo (Zhuyin) resolver.
 *
 * Zhuyin lyrics already carry the pronunciation, so the desktop never guesses a Han character, a
 * lexical reading, or a word tone for them. A standard run maps to numbered Pinyin and then goes
 * through the same Mandarin spelling renderer as every other reading. Anything outside the standard
 * inventory keeps its source text exactly: an unsupported symbol or an incomplete syllable rejects
 * the whole run instead of leaving a half-converted line.
 *
 * The inventory mirrors the Android resolver (`ZhuyinResolver.java`), table included, so both
 * platforms compare against the same legal syllable set.
 */
export const MANDARIN_ZHUYIN_REVISION = "zhuyin-2026-11-18.2";

export type ZhuyinSyllable = Readonly<{
  /** UTF-16 start in the source text, including an authored prefix neutral dot. */
  start: number;
  /** UTF-16 end, including an authored tone mark. */
  end: number;
  /** Source slice, for diagnostics and parity rows. */
  source: string;
  /** Canonical numbered Pinyin, e.g. "mu3". */
  pinyin: string;
}>;

export type ZhuyinRun = Readonly<{
  /** UTF-16 start of the maximal run. */
  start: number;
  /** UTF-16 end of the maximal run. */
  end: number;
  /** Exact source slice, including a terminal neutral dot. */
  source: string;
  /** Space-joined numbered Pinyin for the run; empty when the run is not entirely standard. */
  pinyin: string;
  syllables: readonly ZhuyinSyllable[];
  /** False when any symbol, shape or tone mark in the run is unsupported. */
  valid: boolean;
}>;

const INITIALS = ["b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "zh", "ch", "sh", "r", "z", "c", "s"] as const;
const SYMBOLS = ["ㄅ", "ㄆ", "ㄇ", "ㄈ", "ㄉ", "ㄊ", "ㄋ", "ㄌ", "ㄍ", "ㄎ", "ㄏ", "ㄐ", "ㄑ", "ㄒ", "ㄓ", "ㄔ", "ㄕ", "ㄖ", "ㄗ", "ㄘ", "ㄙ"] as const;
const FINALS = [
  "a", "o", "e", "ê", "ai", "ei", "ao", "ou", "an", "en", "ang", "eng", "er", "i", "ia", "io",
  "ie", "iao", "iou", "ian", "in", "iang", "ing", "iong", "u", "ua", "uo", "uai", "uei", "uan",
  "uen", "uang", "ueng", "ü", "üe", "üan", "ün",
] as const;
const RHYMES = [
  "ㄚ", "ㄛ", "ㄜ", "ㄝ", "ㄞ", "ㄟ", "ㄠ", "ㄡ", "ㄢ", "ㄣ", "ㄤ", "ㄥ", "ㄦ", "ㄧ", "ㄧㄚ", "ㄧㄛ",
  "ㄧㄝ", "ㄧㄠ", "ㄧㄡ", "ㄧㄢ", "ㄧㄣ", "ㄧㄤ", "ㄧㄥ", "ㄩㄥ", "ㄨ", "ㄨㄚ", "ㄨㄛ", "ㄨㄞ", "ㄨㄟ",
  "ㄨㄢ", "ㄨㄣ", "ㄨㄤ", "ㄨㄥ", "ㄩ", "ㄩㄝ", "ㄩㄢ", "ㄩㄣ",
] as const;
/** Legal finals per initial, in the same order and spelling as the Android table. */
const INVENTORY_ROWS = [
  "b a o ai ei ao an en ang eng i ie iao ian in ing u",
  "p a o ai ei ao ou an en ang eng i ie iao ian in ing u",
  "m a o e ai ei ao ou an en ang eng i ie iao iu ian in ing u",
  "f a o ei ou an en ang eng u",
  "d a e ai ei ao ou an en ang eng ong i ie iao iu ian ing u uo ui uan un",
  "t a e ai ei ao ou an ang eng ong i ie iao ian ing u uo ui uan un",
  "n a e ai ei ao ou an en ang eng ong i ie iao iu ian in iang ing u uo uan ü üe",
  "l a o e ai ei ao ou an ang eng ong i ia ie iao iu ian in iang ing u uo uan un ü üe",
  "g a e ai ei ao ou an en ang eng ong u ua uo uai ui uan un uang",
  "k a e ai ei ao ou an en ang eng ong u ua uo uai ui uan un uang",
  "h a e ai ei ao ou an en ang eng ong u ua uo uai ui uan un uang",
  "j i ia ie iao iu ian in iang ing iong u ue uan un",
  "q i ia ie iao iu ian in iang ing iong u ue uan un",
  "x i ia ie iao iu ian in iang ing iong u ue uan un",
  "zh a e ai ei ao ou an en ang eng ong i u ua uo uai ui uan un uang",
  "ch a e ai ao ou an en ang eng ong i u ua uo uai ui uan un uang",
  "sh a e ai ei ao ou an en ang eng i u ua uo uai ui uan un uang",
  "r e ao ou an en ang eng ong i u uo ui uan un",
  "z a e ai ei ao ou an en ang eng ong i u uo ui uan un",
  "c a e ai ao ou an en ang eng ong i u uo ui uan un",
  "s a e ai ao ou an en ang eng ong i u uo ui uan un",
  "_ a o e ê ai ei ao ou an en ang eng er yi ya yo ye yao you yan yin yang ying yong wu wa wo wai wei wan wen wang weng yu yue yuan yun",
] as const;

function buildInventory(): ReadonlyMap<string, string> {
  const inventory = new Map<string, string>();
  for (const row of INVENTORY_ROWS) {
    const cells = row.split(" ");
    const initial = cells[0]!;
    const onset = initial === "_" ? "" : SYMBOLS[INITIALS.indexOf(initial as (typeof INITIALS)[number])]!;
    for (let index = 1; index < cells.length; index += 1) {
      let final = cells[index]!;
      const pinyin = (initial === "_" ? "" : initial) + final;
      if (initial === "_") {
        if (final.startsWith("yu")) final = `ü${final.slice(2)}`;
        else if (final.startsWith("yi")) final = `i${final.slice(2)}`;
        else if (final.startsWith("y")) final = `i${final.slice(1)}`;
        else if (final.startsWith("wu")) final = `u${final.slice(2)}`;
        else if (final.startsWith("w")) final = `u${final.slice(1)}`;
      } else if (/^(j|q|x)$/u.test(initial) && final.startsWith("u")) {
        final = `ü${final.slice(1)}`;
      }
      if (final === "iu") final = "iou";
      if (final === "ui") final = "uei";
      if (final === "un") final = "uen";
      if (final === "ong") final = "ueng";
      if (final === "i" && /^(zh|ch|sh|r|z|c|s)$/u.test(initial)) {
        inventory.set(onset, pinyin);
        continue;
      }
      const rhyme = RHYMES[FINALS.indexOf(final as (typeof FINALS)[number])];
      if (rhyme !== undefined) inventory.set(onset + rhyme, pinyin);
    }
  }
  return inventory;
}

const INVENTORY = buildInventory();
const TONES: Readonly<Record<string, 1 | 2 | 3 | 4 | 5>> = {
  "ˉ": 1, "ˊ": 2, "ˇ": 3, "ˋ": 4, "˙": 5,
};
const INITIAL_SYMBOLS = new Set(SYMBOLS);
const MEDIAL_SYMBOLS = new Set(["ㄧ", "ㄨ", "ㄩ"]);
/** Finals that attach to an initial or medial. ㄦ is a syllable of its own, never a final here. */
const FINAL_SYMBOLS = new Set(["ㄚ", "ㄛ", "ㄜ", "ㄝ", "ㄞ", "ㄟ", "ㄠ", "ㄡ", "ㄢ", "ㄣ", "ㄤ", "ㄥ"]);
const HAN_YI = "一";
/**
 * Authored lyrics sometimes type the vowel ㄧ as the Han numeral 一 (U+4E00). The alias is allowed
 * only immediately after a Bopomofo initial that has a legal initial + ㄧ syllable. Apical initials
 * (ㄓㄔㄕㄖㄗㄘㄙ) are deliberately absent: ㄓ一 is zhi plus an ordinary Han 一, not an apical medial.
 */
const HAN_YI_ALIAS_INITIALS = new Set(["ㄅ", "ㄆ", "ㄇ", "ㄉ", "ㄊ", "ㄋ", "ㄌ", "ㄐ", "ㄑ", "ㄒ"]);

/** Compatible inventory rows for parity with the Android resolver. */
export function zhuyinInventory(): readonly Readonly<{ zhuyin: string; pinyin: string }>[] {
  return [...INVENTORY].map(([zhuyin, pinyin]) => ({ zhuyin, pinyin }));
}

/** A standard or extended Bopomofo symbol; only standard symbols have readings. */
export function isZhuyinSymbol(codePoint: number): boolean {
  return (codePoint >= 0x3100 && codePoint <= 0x312f) || (codePoint >= 0x31a0 && codePoint <= 0x31bf);
}

function isStandardSymbol(text: string): boolean {
  if (!text) return false;
  const codePoint = text.codePointAt(0)!;
  return codePoint >= 0x3105 && codePoint <= 0x3129;
}

export function hasZhuyin(text: string): boolean {
  for (const character of text) {
    if (isZhuyinSymbol(character.codePointAt(0)!)) return true;
  }
  return false;
}

const toneOf = (character: string): number => TONES[character] ?? 0;

function isToneMark(character: string | undefined): boolean {
  return character !== undefined && toneOf(character) !== 0;
}

function canAliasHanYi(text: string, index: number): boolean {
  if (text[index] !== HAN_YI) return false;
  return isHanYiAliasAfter(text[index - 1] ?? "");
}

/** True when a Han 一 immediately after this Bopomofo initial is an authored ㄧ medial. */
export function isHanYiAliasAfter(previous: string): boolean {
  return previous !== "" && isStandardSymbol(previous) && HAN_YI_ALIAS_INITIALS.has(previous);
}

type ParsedRun = Readonly<{ syllables: readonly ZhuyinSyllable[]; valid: boolean }>;

function parseRun(text: string, start: number, end: number): ParsedRun {
  const syllables: ZhuyinSyllable[] = [];
  let at = start;
  while (at < end) {
    const syllableStart = at;
    const neutralPrefix = text[at] === "˙";
    if (neutralPrefix) at += 1;
    // Consume the longest legal syllable *shape* first, then validate it against the inventory.
    // Consuming the longest legal syllable instead would split invalid ㄇㄨㄚ into mu + a.
    let shape = "";
    const first = text[at];
    const shapeOf = (character: string) => (character === HAN_YI ? "ㄧ" : character);
    if (first !== undefined && INITIAL_SYMBOLS.has(first)) {
      shape = first;
      at += 1;
      if (at < end && (MEDIAL_SYMBOLS.has(text[at]!) || text[at] === HAN_YI)) shape += shapeOf(text[at++]!);
      if (at < end && FINAL_SYMBOLS.has(text[at]!)) shape += shapeOf(text[at++]!);
    } else if (first !== undefined && (MEDIAL_SYMBOLS.has(first) || first === HAN_YI)) {
      shape = first;
      at += 1;
      if (at < end && FINAL_SYMBOLS.has(text[at]!)) shape += shapeOf(text[at++]!);
    } else if (first !== undefined && (FINAL_SYMBOLS.has(first) || first === "ㄦ")) {
      shape = first;
      at += 1;
    }
    const reading = shape ? INVENTORY.get(shape) : undefined;
    if (reading === undefined) return { syllables: [], valid: false };
    let digit = neutralPrefix ? 5 : 1;
    if (at < end && isToneMark(text[at])) {
      // A dot before another syllable is that syllable's neutral prefix, not this syllable's suffix.
      if (text[at] === "˙" && at + 1 !== end) {
        // Leave the dot for the next syllable.
      } else {
        if (neutralPrefix) return { syllables: [], valid: false };
        digit = toneOf(text[at]!);
        at += 1;
      }
    }
    syllables.push({ start: syllableStart, end: at, source: text.slice(syllableStart, at), pinyin: `${reading}${digit}` });
  }
  if (!syllables.length || syllables[syllables.length - 1]!.end !== end) return { syllables: [], valid: false };
  return { syllables, valid: true };
}

/**
 * Every maximal Bopomofo candidate run, valid or not. Invalid runs are returned so the Mandarin
 * fallback can keep them completely literal instead of separately converting a Han 一 alias.
 */
export function scanZhuyinRuns(text: string): readonly ZhuyinRun[] {
  const runs: ZhuyinRun[] = [];
  for (let index = 0; index < text.length;) {
    const first = text[index]!;
    if (!isZhuyinSymbol(first.codePointAt(0)!) && !isToneMark(first)) {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < text.length) {
      const next = text[end]!;
      if (isZhuyinSymbol(next.codePointAt(0)!) || isToneMark(next)) {
        end += 1;
        continue;
      }
      if (canAliasHanYi(text, end)) {
        end += 1;
        continue;
      }
      break;
    }
    const parsed = parseRun(text, index, end);
    runs.push({
      start: index,
      end,
      source: text.slice(index, end),
      pinyin: parsed.syllables.map((syllable) => syllable.pinyin).join(" "),
      syllables: parsed.syllables,
      valid: parsed.valid,
    });
    index = end;
  }
  return runs;
}

/**
 * Resolve every valid maximal run. A run is all-or-nothing: an unsupported symbol, an incomplete
 * syllable or a misplaced tone mark drops the whole run, so the source stays literal.
 */
export function resolveZhuyinSpans(text: string): readonly ZhuyinRun[] {
  return scanZhuyinRuns(text).filter((run) => run.valid);
}

/** Resolve one exact Zhuyin run, or undefined when the run is not entirely standard. */
export function zhuyinRunToNumberedPinyin(text: string): string | undefined {
  const spans = resolveZhuyinSpans(text);
  return spans.length === 1 && spans[0]!.start === 0 && spans[0]!.end === text.length ? spans[0]!.pinyin : undefined;
}
