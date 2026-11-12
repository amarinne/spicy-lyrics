/**
 * Mandarin eza式 surface tones (policy eza-2026-11-12.2, decisions M1a, M1b and M4a).
 *
 * Mandarin eza式 spells the tones as spoken. This module rewrites the citation tone digits of one
 * line to its connected-speech tones before the spelling rules in `MandarinVnAid.ts` run, so
 * `ni3 hao3` is spelled `ní hảo`. Standard Pinyin keeps the citation reading; only the eza式 layer
 * reads this output.
 *
 *   1. A domain is a run of adjacent Han tokens with one known syllable per character. Anything
 *      else (a gap, punctuation, whitespace, Latin text, a digit, a missing reading) ends it.
 *   2. A single character repeated three or more times keeps its citation tones (raw repeat).
 *   3. Neutral flags: dictionary positions on the token, and a verb of one character repeated once.
 *   3b. Function morphemes: a single-character token tagged as a particle (的 得 地 着 了 过, modal particles) and a
 *      plural 们 are neutral, with the particle's reading (letters change too).
 *   4. An infix 不 between two identical characters (对不对, 要不要) is neutral, whatever the tokens are, and wins
 *      over the 不-before-tone-4 rule, except around a particle (得不得了) or in a repeated word (不是不是).
 *      A three-character token with 不 in the middle (看不懂, 差不多) is neutral, except a conjunction or adverb (只不过). Otherwise 不 and 一 take their lexical tone from the next token.
 *      A tone 4 before a tone 4 inside one token is spoken flat, as tone 1 (代价 dài jià is written dai jià).
 *   5. Third tones lower by feet: a token is a foot and is never split; a three-syllable token uses
 *      its subwords; single-character tokens follow the run formula (pairs from the left, an odd run
 *      ends 1+2); a stray attaches to the foot beside it; two feet never merge.
 *   6. Each neutral tone takes the pitch of the syllable before it (`realizeNeutralTones`).
 *
 * Port of the cjk-labs reference (`src/languages/chinese/eza-sandhi.ts` and `tone-sandhi.ts`).
 * Tone digits: 1-4 citation tones, 0 or 5 neutral (level), 6 neutral realized falling. Digit 6 is
 * eza式-internal and never reaches Standard Pinyin.
 */

export const MANDARIN_EZA_REVISION = "eza-2026-11-12.2" as const;

/** One word token of a line, from the segmenter. Only Han tokens take part in sandhi. */
export type MandarinEzaToken = {
  readonly surface: string;
  /** Code-point offset of the token in the line. */
  readonly start: number;
  /** `cut_for_search` subwords of a token of three or more characters, without the token itself. */
  readonly searchPieces?: readonly string[];
  /** Part-of-speech tag (jieba). A tag starting with `v` marks a verb. */
  readonly pos?: string;
  /** Character positions the dictionary marks neutral (M1b). */
  readonly dictionaryNeutral?: readonly number[];
};

const SYLLABLE = /^([a-zü]+)([0-6])$/u;
const NEUTRAL = 5;
const length = (text: string) => Array.from(text).length;
const toneOf = (syllable: string) => {
  const tone = Number(syllable.at(-1));
  return tone === 0 ? NEUTRAL : tone;
};
/** `syllable` with its tone digit replaced; neutral 5 is written 0. */
const withTone = (syllable: string, tone: number) => `${syllable.slice(0, -1)}${tone === NEUTRAL ? 0 : tone}`;

/**
 * The neutral tone has no pitch of its own, so Mandarin eza式 writes the pitch it takes from the
 * syllable before it (owner 2026-11-12). After tone 1 or 4 the first neutral falls, written as tone 6
 * (a grave); after tone 2 or 3 it stays level, written with no mark. Because the neutral syllable
 * carries the fall, a tone 4 before it starts high and is written as tone 1. Later neutrals in the
 * same run, and a neutral with no syllable before it, stay level.
 */
export function realizeNeutralTones(tones: readonly number[]): number[] {
  const out = tones.map((tone) => (tone === 5 ? 0 : tone));
  out.forEach((tone, index) => {
    const before = out[index - 1];
    if ((tone !== 0 && tone !== 6) || before === undefined || before === 0 || before === 6) return;
    if (before === 1 || before === 4) {
      out[index] = 6;
      out[index - 1] = 1;
    }
  });
  return out;
}

/** Indices of the third tones to lower in a run of n unattached syllables: pairs from the left, an odd run ends 1+2. */
export function runFormulaLowered(n: number): number[] {
  const lowered: number[] = [];
  const pairEnd = n % 2 ? n - 3 : n;
  for (let index = 0; index < pairEnd; index += 2) lowered.push(index);
  if (n % 2 && n >= 3) lowered.push(n - 2);
  return lowered;
}

// ─── 不 and 一 (PaddleSpeech reference rules, tone_sandhi r1.5.0) ─────────────

const BU = "不";
const YI = "一";
/** The reference keeps a citation 一 when the next character is punctuation. */
const PUNCTUATION = "、：，；。？！“”‘’':,;.?!";

/** Han numerals: 一二三, 十, 百, 千, 万, 亿 and 零. Digit characters count too. */
export const HAN_NUMERALS = "〇零一二三四五六七八九十百千万萬亿億两兩";
const isNumeral = (character: string) => /\p{Nd}/u.test(character) || HAN_NUMERALS.includes(character);

/** A numeral series such as 一零零, 二一零 or 一二三四 keeps every citation tone. */
function isNumeralSeries(characters: readonly string[]): boolean {
  const others = characters.filter((c) => c !== YI);
  return others.length > 0 && others.every(isNumeral);
}

/** Particle readings by jieba tag, for a single-character token: the structural, aspect and modal particles (M1b item 4). */
const FUNCTION_MORPHEMES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  uj: { 的: "de" }, ud: { 得: "de", 的: "de" }, uv: { 地: "de", 的: "de" }, uz: { 着: "zhe", 著: "zhe" }, ul: { 了: "le" }, ug: { 过: "guo", 過: "guo" },
  y: { 吗: "ma", 嗎: "ma", 吧: "ba", 呢: "ne", 啦: "la", 哇: "wa", 呀: "ya", 嘛: "ma" },
};
const PARTICLE_CHARACTERS = "得的地了着著过過吗嗎吧呢啦哇呀嘛";

/** The lexical tones of one unit after the 不 and 一 rules. Tones are 1-5; 5 is neutral. */
export function buYiSandhi(source: string, tones: readonly number[]): number[] {
  const characters = Array.from(source);
  const out = [...tones];
  if (characters.length < 2 || characters.length !== tones.length) return out;
  if (characters.includes(BU)) {
    if (characters.length === 3 && characters[1] === BU) {
      // An infix 不 in a three-character complement such as 看不懂 is neutral.
      out[1] = NEUTRAL;
    } else {
      for (let i = 0; i + 1 < characters.length; i++) {
        if (characters[i] === BU && out[i + 1] === 4) out[i] = 2;
      }
    }
  }
  if (characters.includes(YI)) {
    if (isNumeralSeries(characters)) return out;
    if (characters.length === 3 && characters[1] === YI && characters[0] === characters[2]) {
      out[1] = NEUTRAL;
      return out;
    }
    if (characters[0] === "第" && characters[1] === YI) {
      out[1] = 1;
      return out;
    }
    for (let i = 0; i + 1 < characters.length; i++) {
      if (characters[i] !== YI) continue;
      // 一 after a numeral is part of the number (十一, 二十一) and keeps tone 1.
      if (i > 0 && isNumeral(characters[i - 1])) continue;
      const next = out[i + 1];
      if (next === 4 || next === NEUTRAL) out[i] = 2;
      else if (!PUNCTUATION.includes(characters[i + 1])) out[i] = 4;
    }
  }
  return out;
}

// ─── Domains and feet ─────────────────────────────────────────────────────────

type Entry = { readonly token: MandarinEzaToken; readonly syllables: readonly string[]; readonly offset: number };

/** 不 and 一 join the token after them; 一 between two identical single-character tokens joins both. */
function mergeBuAndYi(run: readonly Entry[]): Entry[][] {
  const out: Entry[][] = [];
  const isSingle = (unit: readonly Entry[], surface: string) => unit.length === 1 && unit[0].token.surface === surface;
  const isOneCharacter = (unit: readonly Entry[]) => unit.length === 1 && length(unit[0].token.surface) === 1;
  const surfaceOf = (unit: readonly Entry[]) => unit.map((entry) => entry.token.surface).join("");
  for (let index = 0; index < run.length; index++) {
    const unit = [run[index]];
    const next = run[index + 1] ? [run[index + 1]] : undefined;
    if (isSingle(unit, BU) && next) {
      out.push([...unit, ...next]);
      index++;
      continue;
    }
    if (isSingle(unit, YI) && next) {
      const before = out.at(-1);
      if (before && isOneCharacter(before) && isOneCharacter(next) && surfaceOf(before) === surfaceOf(next)) {
        out.splice(-1, 1, [...before, ...unit, ...next]);
      } else out.push([...unit, ...next]);
      index++;
      continue;
    }
    out.push(unit);
  }
  return out;
}

/** Where a three-syllable word splits, from its subwords: the shortest leads when the word starts with it, else trails. */
function threeSyllableLead(token: MandarinEzaToken): 1 | 2 | undefined {
  const surface = token.surface;
  const pieces = (token.searchPieces ?? []).filter((piece) => piece !== surface && surface.includes(piece));
  if (!pieces.length) return undefined;
  const shortest = pieces.reduce((best, piece) => (length(piece) < length(best) ? piece : best));
  const lead = surface.startsWith(shortest) ? length(shortest) : surface.endsWith(shortest) ? 3 - length(shortest) : undefined;
  return lead === 1 || lead === 2 ? lead : undefined;
}

type Segment = { kind: "word" | "mono"; token: MandarinEzaToken; start: number; end: number; tokenLength: number };

/** Lower the third tones of one maximal run [start, end) of the flat tone list, by feet. */
function lowerRun(tones: number[], tokenOf: readonly number[], tokens: readonly MandarinEzaToken[], start: number, end: number): void {
  const segments: Segment[] = [];
  for (let index = start; index < end;) {
    const owner = tokenOf[index];
    let stop = index;
    while (stop < end && tokenOf[stop] === owner) stop++;
    const tokenLength = length(tokens[owner].surface);
    const previous = segments.at(-1);
    if (tokenLength === 1 && previous?.kind === "mono") previous.end = stop;
    else segments.push({ kind: tokenLength === 1 ? "mono" : "word", token: tokens[owner], start: index, end: stop, tokenLength });
    index = stop;
  }
  segments.forEach((segment, position) => {
    const size = segment.end - segment.start;
    let lowered: number[];
    if (segment.kind === "mono") {
      // A leftover syllable before a foot binds to that foot, so only the pairs before it lower.
      const bindsRight = segments[position + 1]?.kind === "word" && size % 2 === 1;
      lowered = bindsRight ? runFormulaLowered(size - 1) : runFormulaLowered(size);
    } else if (size === 3 && segment.tokenLength === 3 && threeSyllableLead(segment.token)) {
      lowered = threeSyllableLead(segment.token) === 2 ? [0, 1] : [1];
    } else lowered = size >= 2 ? runFormulaLowered(size) : [];
    for (const offset of lowered) tones[segment.start + offset] = 2;
  });
  // A stray syllable attaches to the foot beside it; two feet never merge.
  for (let position = segments.length - 2; position >= 0; position--) {
    const left = segments[position];
    const right = segments[position + 1];
    if (left.kind === right.kind || tones[left.end - 1] !== 3 || tones[right.start] !== 3) continue;
    const strayBindsRight = left.kind === "word" && right.kind === "mono" && right.end - right.start === 1 && segments[position + 2]?.kind === "word";
    if (!strayBindsRight) tones[left.end - 1] = 2;
  }
}

/** The surface syllables of one domain. */
function surfaceDomain(run: readonly Entry[]): string[] {
  const flat = run.flatMap((entry) => entry.syllables);
  const chars = run.flatMap((entry) => Array.from(entry.token.surface));
  const tokens = run.map((entry) => entry.token);
  const tokenOf = run.flatMap((entry, index) => entry.syllables.map(() => index));
  const tones = flat.map(toneOf);

  // Raw repeat: a character repeated three or more times in a row keeps its citation tones.
  const raw = new Set<number>();
  for (let start = 0; start < chars.length;) {
    let stop = start;
    while (stop < chars.length && chars[stop] === chars[start]) stop++;
    if (stop - start >= 3) for (let index = start; index < stop; index++) raw.add(index);
    start = stop;
  }

  // Neutral flags: dictionary positions and a verb repeated once (试试).
  let offset = 0;
  for (const entry of run) {
    const size = entry.syllables.length;
    for (const position of entry.token.dictionaryNeutral ?? []) {
      if (position < size && !raw.has(offset + position)) tones[offset + position] = NEUTRAL;
    }
    const own = Array.from(entry.token.surface);
    if (size === 2 && own[0] === own[1] && entry.token.pos?.startsWith("v") && !raw.has(offset + 1)) tones[offset + 1] = NEUTRAL;
    offset += size;
  }

  // Function morphemes: a particle token (的地得 着 了 过, modal particles) and a plural 们 are neutral, with the particle's reading.
  const letters = new Map<number, string>();
  offset = 0;
  for (const entry of run) {
    const size = entry.syllables.length;
    const own = Array.from(entry.token.surface);
    for (let at = 0; at < size; at++) {
      const index = offset + at;
      const particle = size === 1 ? FUNCTION_MORPHEMES[entry.token.pos ?? ""]?.[own[at]] : undefined;
      const plural = (own[at] === "们" || own[at] === "們") && index > 0 ? "men" : undefined;
      const wanted = particle ?? plural;
      if (wanted && !raw.has(index)) {
        letters.set(index, wanted);
        tones[index] = NEUTRAL;
      }
    }
    offset += size;
  }

  // An infix 不 between two identical characters (对不对, 要不要) is neutral, whatever the tokens are. A particle between
  // them (得不得了) and a repeated word (不是不是) are not that pattern. 一 after a numeral (十一) keeps tone 1.
  const infix: number[] = [];
  const numeralYi: number[] = [];
  for (let index = 1; index + 1 < chars.length; index++) {
    if (chars[index] === BU && chars[index - 1] === chars[index + 1] && chars[index - 2] !== BU && !PARTICLE_CHARACTERS.includes(chars[index - 1])
      && ![index - 1, index, index + 1].some((at) => raw.has(at))) infix.push(index);
    if (chars[index] === YI && HAN_NUMERALS.includes(chars[index - 1]) && !raw.has(index)) numeralYi.push(index);
  }
  for (const index of infix) tones[index] = NEUTRAL;

  // 不 and 一 take their lexical tone from the next token.
  const base = run[0]?.offset ?? 0;
  for (const unit of mergeBuAndYi(run)) {
    const first = unit[0].offset - base;
    const count = unit.reduce((sum, entry) => sum + entry.syllables.length, 0);
    if (count < 2 || Array.from({ length: count }, (_, index) => first + index).some((index) => raw.has(index))) continue;
    const surface = Array.from(unit.map((entry) => entry.token.surface).join(""));
    // A three-character token with 不 in the middle is neutral (看不懂, 差不多), except a conjunction or adverb
    // (只不过, 不过): bú guò. The rule then runs on the last two characters only.
    const skip = unit.length === 1 && count === 3 && surface[1] === BU && /^[cd]/u.test(unit[0].token.pos ?? "") ? 1 : 0;
    buYiSandhi(surface.slice(skip).join(""), tones.slice(first + skip, first + count)).forEach((tone, index) => {
      tones[first + skip + index] = tone;
    });
  }

  for (const index of infix) tones[index] = NEUTRAL;
  for (const index of numeralYi) tones[index] = 1;

  // A tone 4 before a tone 4 inside one token is spoken flat, as tone 1. Feet and single-character tokens do not affect each other.
  const fourths = tones.slice();
  for (let index = 0; index + 1 < tones.length; index++) {
    if (fourths[index] === 4 && fourths[index + 1] === 4 && tokenOf[index] === tokenOf[index + 1] && !raw.has(index) && !raw.has(index + 1)) tones[index] = 1;
  }

  // Third-tone feet over each maximal run of third tones.
  for (let start = 0; start < tones.length;) {
    if (tones[start] !== 3 || raw.has(start)) {
      start++;
      continue;
    }
    let stop = start;
    while (stop < tones.length && tones[stop] === 3 && !raw.has(stop)) stop++;
    lowerRun(tones, tokenOf, tokens, start, stop);
    start = stop;
  }

  const realized = realizeNeutralTones(tones);
  return flat.map((syllable, index) => (raw.has(index) ? syllable : withTone(letters.has(index) ? `${letters.get(index)}0` : syllable, realized[index])));
}

/**
 * The surface syllables of one line.
 *
 * `syllables` holds one citation syllable per code point of the line (`ni3`, `de0`), or undefined
 * where there is none. `tokens` are the line's Han word tokens in order. The result has the same
 * shape; syllables outside every domain are returned unchanged.
 */
export function mandarinEzaSurfaceSyllables(
  syllables: readonly (string | undefined)[],
  tokens: readonly MandarinEzaToken[],
): (string | undefined)[] {
  const out = [...syllables];
  let run: Entry[] = [];
  let runEnd = -1;
  const flush = () => {
    if (run.length) {
      const surface = surfaceDomain(run);
      surface.forEach((syllable, index) => {
        out[run[0].offset + index] = syllable;
      });
    }
    run = [];
  };
  for (const token of tokens) {
    const size = length(token.surface);
    const own = syllables.slice(token.start, token.start + size);
    const known = size > 0 && own.length === size && own.every((syllable) => syllable !== undefined && SYLLABLE.test(syllable));
    if (!known || token.start !== runEnd) flush();
    if (known) {
      run.push({ token, syllables: own as string[], offset: token.start });
      runEnd = token.start + size;
    } else runEnd = -1;
  }
  flush();
  return out;
}
