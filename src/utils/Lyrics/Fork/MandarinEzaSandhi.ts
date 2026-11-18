import { HAN_NUMERALS } from "./MandarinEzaTones.ts";

/**
 * Layer 2 of Mandarin eza式 revision 3: tone changes from 一, 不 and third tones.
 * Policy `eza-2026-11-15.3`, matching the cjk-labs reference (`src/languages/chinese/eza-sandhi.ts`).
 *
 * It reads only the layer-1 contract. It never chooses a reading, changes letters, or writes tone marks.
 * Input contract: 一 is `yi1`, 不 is `bu4`, and a neutral syllable carries its real tone when the data has one.
 * Output digits: 1-4 are surface tones; 0 is a neutral with no mark, 6 a neutral grave and 7 a neutral hook.
 * The neutral digit records the pitch class that only this layer can decide: a sandhi 2 from a lowered third
 * tone does not make a following neutral rise. Layer 3 renders 6 and 7 as marks.
 */
export const EZA_SANDHI_REVISION = "eza-2026-11-15.3" as const;
/** Historic name kept for the processing context and parity evidence. */
export const MANDARIN_EZA_REVISION = EZA_SANDHI_REVISION;

/** One layer-1 syllable: letters, the real tone and the N flag. */
export type MandarinEzaSyllable = Readonly<{
  status: "available";
  letters: string;
  tone: 1 | 2 | 3 | 4 | 5;
  neutral: boolean;
  alwaysNeutral?: true;
  alternatives?: readonly string[];
  /** Authored Bopomofo: the source slice for this syllable, including its tone mark. */
  source?: string;
  authored?: true;
}> | Readonly<{ status: "unavailable"; reason: string }>;

/** One segmenter token with its layer-1 syllables; only Han tokens take part in sandhi. */
export type MandarinEzaToken = Readonly<{
  text: string;
  range: Readonly<{ start: number; end: number }>;
  kind: string;
  tag: string;
  subwords: readonly string[];
  syllables: readonly MandarinEzaSyllable[];
}>;

export type MandarinEzaReadingLine = Readonly<{ text: string; tokens: readonly MandarinEzaToken[] }>;

const NEUTRAL = 0;
const NEUTRAL_GRAVE = 6;
const NEUTRAL_HOOK = 7;
/** Structural particles keep an identical-character 不 out of the reduplicated-verb pattern (得不得了). */
const PARTICLE_CHARACTERS = "得的地了着著过過吗嗎吧呢啦哇呀嘛啊";
const PRONOUNS = "我你";
const SYLLABLE = /^([a-zü]+)([0-7])$/u;
const ONSETS = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "z", "c", "s", "j", "q", "x", "r"] as const;
/** A zero-onset spelling and the final it stands for. */
const ZERO_ONSET_FINALS: Readonly<Record<string, string>> = {
  yi: "i", ya: "ia", ye: "ie", yao: "iao", you: "iou", yan: "ian", yin: "in", yang: "iang", ying: "ing", yong: "iong",
  yu: "ü", yue: "üe", yuan: "üan", yun: "ün",
  wu: "u", wa: "ua", wo: "uo", wai: "uai", wei: "uei", wan: "uan", wen: "uen", wang: "uang", weng: "ueng",
};

const length = (text: string) => Array.from(text).length;
const digitOf = (syllable: string) => Number(syllable.at(-1));
const lettersOf = (syllable: string) => syllable.slice(0, -1);
const isNumeral = (character: string) => /\p{Nd}/u.test(character) || HAN_NUMERALS.includes(character);

type Entry = Readonly<{ token: MandarinEzaToken; syllables: readonly string[] }>;

/** The final class of a reading: a reduced open e, a high vowel, or any other full vowel. */
export function finalClass(letters: string): "reduced" | "high" | "full" {
  const final = ZERO_ONSET_FINALS[letters] ?? letters.slice((ONSETS.find((onset) => letters.startsWith(onset)) ?? "").length);
  if (final === "e") return "reduced";
  if (final === "i" || final === "u" || final === "ü") return "high";
  return "full";
}

/** One maximal run of adjacent Han tokens with a known syllable per character. */
function domainOf(run: readonly Entry[]) {
  const flat = run.flatMap((entry) => entry.syllables);
  const chars = run.flatMap((entry) => Array.from(entry.token.text));
  const tokens = run.map((entry) => entry.token);
  const tokenOf = run.flatMap((entry, index) => entry.syllables.map(() => index));
  const tokenStart = run.flatMap((entry) => entry.syllables.map(() => entry.token.range.start));
  const syllableOf = run.flatMap((entry) => entry.token.syllables);
  const letters = flat.map(lettersOf);
  const realTone = syllableOf.map((syllable) => (syllable.status === "unavailable" ? 5 : syllable.tone));
  const neutral = syllableOf.map((syllable) => syllable.status !== "unavailable" && syllable.neutral);
  const alwaysNeutral = syllableOf.map((syllable) => syllable.status !== "unavailable" && syllable.alwaysNeutral === true);
  const surface = flat.map((syllable, index) => (neutral[index] ? NEUTRAL : digitOf(syllable)));
  return { flat, chars, tokens, tokenOf, tokenStart, letters, realTone, neutral, alwaysNeutral, surface };
}
type Domain = ReturnType<typeof domainOf>;

/** The tone a following neutral contributes to 一 and 不: its real tone, never its neutral surface. */
function effectiveTone(domain: Domain, index: number): number | undefined {
  if (index >= domain.surface.length) return undefined;
  return domain.neutral[index] ? domain.realTone[index]! : domain.surface[index]!;
}

/** A verb token: jieba folds every verb subclass under `v` (v, vd, vn, vi, vshi, ...). */
const isVerb = (token: MandarinEzaToken | undefined) => token !== undefined && token.tag.startsWith("v");

/** 一 keeps tone 1 as an ordinal (第一), in a digit series (一九一) and after a numeral (十一). */
function keepsYiTone(domain: Domain, index: number): boolean {
  const before = domain.chars[index - 1];
  if (before === "第") return true;
  if (before !== undefined && isNumeral(before)) return true;
  const chars = Array.from(domain.tokens[domain.tokenOf[index]!]!.text);
  return chars.length > 1 && chars.every(isNumeral);
}

/** 一 between a verb and a measure word is neutral: 走一趟, 来一趟, 买一个, 睡一觉. */
function isVerbMeasure(domain: Domain, index: number): boolean {
  const before = domain.tokenOf[index - 1], after = domain.tokenOf[index + 1];
  if (before === undefined || after === undefined) return false;
  // The verb and 一 share a token (去一趟, 睡一觉): the token covers the verb and carries a measure subword.
  if (before === after && before === domain.tokenOf[index]) {
    const token = domain.tokens[before]!;
    if (!isVerb(token) && token.tag !== "i") return false;
    return token.subwords.includes(domain.chars.slice(index, index + 2).join(""));
  }
  if (!isVerb(domain.tokens[before])) return false;
  // Separate tokens: 来 / 一趟, 买 / 一个. A two-character numeral-classifier token is a measure phrase;
  // a longer time word (一会儿) is not.
  const next = domain.tokens[after]!;
  return next.range.start === index && length(next.text) === 2 && /^[mq]/u.test(next.tag);
}

/** 不 in verb + 不 + complement (看不懂, 睡不着) or between identical characters (对不对) is neutral. */
function isNeutralBu(domain: Domain, index: number): boolean {
  const token = domain.tokens[domain.tokenOf[index]!]!;
  const inside = domain.tokenOf[index] === domain.tokenOf[index - 1] && domain.tokenOf[index] === domain.tokenOf[index + 1];
  if (inside && length(token.text) === 3 && isVerb(token)) return true;
  const left = domain.chars[index - 1], right = domain.chars[index + 1];
  return left !== undefined && left === right && domain.chars[index - 2] !== "不" && !PARTICLE_CHARACTERS.includes(left);
}

/** 一 between identical characters is the reduplicated-verb pattern (看一看, 数一数). */
function isNeutralYi(domain: Domain, index: number): boolean {
  const left = domain.chars[index - 1], right = domain.chars[index + 1];
  return left !== undefined && left === right && !isNumeral(left);
}

function applyBuYi(domain: Domain): void {
  const { surface, chars } = domain;
  for (let index = 0; index < chars.length; index++) {
    if (chars[index] === "一") {
      if (keepsYiTone(domain, index)) continue;
      if (isNeutralYi(domain, index) || isVerbMeasure(domain, index)) { surface[index] = NEUTRAL; continue; }
      const next = effectiveTone(domain, index + 1);
      if (next === 4) surface[index] = 2;
      else if (next !== undefined && next >= 1 && next <= 3) surface[index] = 4;
      continue;
    }
    if (chars[index] !== "不") continue;
    if (isNeutralBu(domain, index)) { surface[index] = NEUTRAL; continue; }
    if (effectiveTone(domain, index + 1) === 4) surface[index] = 2;
  }
}

/** Where a three-syllable token splits at this offset, from its search subwords: 2 = word + syllable, 1 = syllable + word. */
function subwordLead(token: MandarinEzaToken, offset: number): 1 | 2 | undefined {
  const chars = Array.from(token.text);
  const leadFound = token.subwords.includes(chars.slice(offset, offset + 2).join(""));
  const trailFound = token.subwords.includes(chars.slice(offset + 1, offset + 3).join(""));
  if (leadFound === trailFound) return undefined;
  return leadFound ? 2 : 1;
}

/** A three-syllable unit: 2 2 3 for word + syllable, verb + object or a repeated character; else 3 2 3. */
function tripleShape(domain: Domain, at: number): "leading" | "trailing" {
  const first = domain.chars[at]!, second = domain.chars[at + 1]!, third = domain.chars[at + 2]!;
  if (first === second && second === third) return "leading";
  if (PRONOUNS.includes(first)) return "trailing";
  const a = domain.tokenOf[at]!, b = domain.tokenOf[at + 1]!, c = domain.tokenOf[at + 2]!;
  if (a === b && b === c) {
    const token = domain.tokens[a]!;
    const lead = subwordLead(token, at - domain.tokenStart[at]!);
    if (lead === 2) return "leading";
    if (lead === 1) return "trailing";
    return isVerb(token) ? "leading" : "trailing";
  }
  if (a === b) return "leading";
  if (b === c) return isVerb(domain.tokens[a]) ? "leading" : "trailing";
  return isVerb(domain.tokens[a]) ? "leading" : "trailing";
}

/** Lower a maximal third-tone run: pairs from the left, an odd run ends with a three-syllable unit. */
function lowerRun(domain: Domain, lowered: Set<number>, start: number, end: number): void {
  const lower = (at: number) => { if (domain.surface[at] === 3) { domain.surface[at] = 2; lowered.add(at); } };
  const n = end - start;
  if (n === 1) return;
  const pairEnd = n % 2 === 1 ? end - 3 : end;
  for (let at = start; at < pairEnd; at += 2) lower(at);
  if (n % 2 === 1) {
    const at = end - 3;
    if (tripleShape(domain, at) === "leading") lower(at);
    lower(at + 1);
  }
}

/** 6 and 7 tell layer 3 which mark to write. A neutral after a lowered third tone stays unmarked. */
function neutralMark(domain: Domain, index: number, lowered: Set<number>): number {
  const before = index > 0 ? domain.surface[index - 1] : undefined;
  if (before === 1 || before === 4) return NEUTRAL_GRAVE;
  if (before !== 2 || lowered.has(index - 1)) return NEUTRAL;
  return finalClass(domain.letters[index]!) === "full" ? NEUTRAL_HOOK : NEUTRAL;
}

function surfaceDomain(run: readonly Entry[]): string[] {
  const domain = domainOf(run);
  applyBuYi(domain);
  const lowered = new Set<number>();
  const { surface } = domain;
  // A tone 3 before a neutral whose real tone is 3 rises only when the word can give that syllable a full tone.
  for (let index = 0; index + 1 < surface.length; index++) {
    if (surface[index] !== 3 || !domain.neutral[index + 1] || domain.realTone[index + 1] !== 3 || domain.alwaysNeutral[index + 1]) continue;
    surface[index] = 2; lowered.add(index);
  }
  // Maximal runs of third tones cross token boundaries. A neutral, another tone or a gap ends a run.
  for (let start = 0; start < surface.length;) {
    if (surface[start] !== 3) { start++; continue; }
    let end = start;
    while (end < surface.length && surface[end] === 3) end++;
    lowerRun(domain, lowered, start, end);
    start = end;
  }
  for (let index = 0; index < surface.length; index++) {
    // Surface digit 0 means neutral, including 一 and 不 that this layer neutralized, so they take a pitch class too.
    if (surface[index] !== NEUTRAL) continue;
    surface[index] = neutralMark(domain, index, lowered);
  }
  return domain.flat.map((_, index) => `${domain.letters[index]}${surface[index]}`);
}

/** Layer 2 rejects a line that did not come out of layer 1 in revision-3 form. */
export function assertSandhiInput(line: MandarinEzaReadingLine): void {
  for (const token of line.tokens) {
    if (token.kind !== "han") continue;
    const chars = Array.from(token.text);
    token.syllables.forEach((syllable, at) => {
      if (syllable.status === "unavailable") return;
      const char = chars[at];
      if (char === "一" && (syllable.letters !== "yi" || syllable.tone !== 1 || syllable.neutral)) {
        throw new TypeError(`Layer 2 input: 一 must be yi1, got ${syllable.letters}${syllable.tone}${syllable.neutral ? " N" : ""}.`);
      }
      if (char === "不" && (syllable.letters !== "bu" || syllable.tone !== 4 || syllable.neutral)) {
        throw new TypeError(`Layer 2 input: 不 must be bu4, got ${syllable.letters}${syllable.tone}${syllable.neutral ? " N" : ""}.`);
      }
      if (syllable.neutral && syllable.tone === 5) {
        const full = (syllable.alternatives ?? []).some((reading) => SYLLABLE.test(reading) && lettersOf(reading) === syllable.letters && digitOf(reading) >= 1 && digitOf(reading) <= 4);
        if (full) throw new TypeError(`Layer 2 input: neutral ${syllable.letters} must carry its real tone.`);
      }
    });
  }
}

/** The surface syllables of each Han token, or undefined outside sandhi. */
export function ezaSurfaceReadings(line: MandarinEzaReadingLine): readonly (readonly string[] | undefined)[] {
  assertSandhiInput(line);
  const out: (readonly string[] | undefined)[] = line.tokens.map(() => undefined);
  let run: Entry[] = [], indices: number[] = [];
  const flush = () => {
    const surface = surfaceDomain(run); let offset = 0;
    run.forEach((entry, index) => { out[indices[index]!] = surface.slice(offset, offset + entry.syllables.length); offset += entry.syllables.length; });
    run = []; indices = [];
  };
  line.tokens.forEach((token, index) => {
    if (token.kind !== "han" || token.syllables.some((syllable) => syllable.status === "unavailable")) { flush(); return; }
    run.push({ token, syllables: token.syllables.map((syllable) => syllable.status === "unavailable" ? "" : `${syllable.letters}${syllable.neutral ? NEUTRAL : syllable.tone}`) });
    indices.push(index);
  });
  flush(); return out;
}
