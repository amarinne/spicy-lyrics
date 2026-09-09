/**
 * Mandarin VN-aid pronunciation renderer.
 *
 * One-way display from Hanyu Pinyin (tone-numbered syllables, as produced by
 * `pinyin-pro` with `toneType: "num"`) into the locked Vietnamese-informed aid
 * spelling. No dictionary, no G2P: the input Pinyin is already the reading.
 *
 * Locked rules implemented here:
 * - stops: b/p', t/t', k/k' with ASCII apostrophe U+0027 as aspiration mark.
 *   Unaspirated members stay single letters (d->t, g->k); do NOT use th/kh.
 * - affricates keep z/ts and zh/ch; contextual j->z, q->ch, x->sh.
 * - /y/ family renders as yu (no ü output): ju->zyu, jue->zyue,
 *   juan->zyuen, jun->zyun; nü->nyu, lü->lyu; yu/yue/yuen/yun.
 * - apical i after z/c/s/zh/ch/sh/r -> ư
 * - e -> ơ, en -> ân, eng -> âng, ian -> ien
 * - ei -> êi; ui -> uei -> uêi (tone anchors to ê)
 * - un/uen -> uân, ueng/weng -> uâng, iu -> iou
 * - bo/po/mo/fo -> buo/puo/muo/fuo
 * - y/w zero-initials retained (you/wei/wo kept as-is)
 * - tones: T1 unmarked, T2 acute, T3 hook above, T4 grave, neutral dot below.
 *   The tone anchors to a quality-marked vowel (ă â ê ô ơ ư) when the rendered
 *   nucleus has one; otherwise the Pinyin tone-bearing-vowel order
 *   (a, then o, then e, then the last i/u) on the explicit final.
 *   Input Pinyin syllable-separator apostrophes are not content and are
 *   stripped before parsing; they never interact with the output mark.
 */

const INITIAL_MAP: Record<string, string> = {
  b: "b",
  p: "p'",
  m: "m",
  f: "f",
  d: "t",
  t: "t'",
  n: "n",
  l: "l",
  g: "k",
  k: "k'",
  h: "h",
  z: "z",
  c: "ts",
  s: "s",
  j: "z",
  q: "ch",
  x: "sh",
  zh: "zh",
  ch: "ch",
  sh: "sh",
  r: "r",
};

const APICAL_INITIALS = new Set(["z", "c", "s", "zh", "ch", "sh", "r"]);
const JU_Q_X = new Set(["j", "q", "x"]);
const LABIALS = new Set(["b", "p", "m", "f"]);

/** Combining marks per Mandarin tone category: T2 acute U+0301, T3 hook U+0309, T4 grave U+0300, neutral dot below U+0323. T1 unmarked. */
const TONE_MARKS: Record<number, string> = {
  1: "",
  2: "\u0301",
  3: "\u0309",
  4: "\u0300",
  0: "\u0323",
};

const NUM_SYLLABLE_TEST = /^([a-zü]+)([0-4])$/u;

function markVowel(vowel: string, tone: number): string {
  const mark = TONE_MARKS[tone] ?? "";
  if (!mark) return vowel;
  return (vowel + mark).normalize("NFC");
}

/**
 * Tone-bearing vowel index inside a mapped aid final.
 *
 * Priority for the tone anchor:
 * 1. a quality-marked vowel (ă â ê ô ơ ư) — quality + tone share one glyph;
 * 2. otherwise the Pinyin order on the explicit final: a, then o, then e;
 * 3. otherwise the last remaining vowel (i/u).
 *
 * Never called with onset text: only the mapped final is scanned, and the
 * output aspiration apostrophe is part of the onset, so tone placement is
 * structural rather than a scan of the rendered string.
 */
const QUALITY_MARKED_VOWELS = new Set(["ă", "â", "ê", "ô", "ơ", "ư"]);

function toneBearingIndex(final: string): number {
  const chars = Array.from(final);
  const quality = chars.findIndex((c) => QUALITY_MARKED_VOWELS.has(c));
  if (quality >= 0) return quality;
  const findFirst = (set: Set<string>): number => chars.findIndex((c) => set.has(c));
  let index = findFirst(new Set(["a"]));
  if (index >= 0) return index;
  index = findFirst(new Set(["o"]));
  if (index >= 0) return index;
  index = findFirst(new Set(["e"]));
  if (index >= 0) return index;
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    if (chars[i] === "i" || chars[i] === "u") return i;
  }
  return -1;
}

function applyTone(aidFinal: string, tone: number, tonesEnabled: boolean): string {
  if (!tonesEnabled || tone === 1) return aidFinal;
  const index = toneBearingIndex(aidFinal);
  if (index < 0) return aidFinal;
  const chars = Array.from(aidFinal);
  chars[index] = markVowel(chars[index], tone);
  return chars.join("");
}

function splitInitial(base: string): { initial: string; final: string } {
  for (const initial of ["zh", "ch", "sh"]) {
    if (base.startsWith(initial) && base.length > initial.length) {
      return { initial, final: base.slice(initial.length) };
    }
  }
  const first = base[0] ?? "";
  if (first && "bpmfdtnlgkhjqxrzcs".includes(first) && base.length > 1) {
    return { initial: first, final: base.slice(1) };
  }
  return { initial: "", final: base };
}

/**
 * Convert one tone-numbered Pinyin syllable (e.g. "zhuang4", "lü4", "wen1",
 * "ni3") into the aid spelling. Non-Pinyin input passes through unchanged.
 */
export function convertMandarinSyllableToVnAid(numSyllable: string, tonesEnabled = true): string {
  const input = (numSyllable || "").normalize("NFKC").trim().toLowerCase().replace(/'/g, "");
  const match = NUM_SYLLABLE_TEST.exec(input);
  if (!match) return numSyllable;
  const base = match[1];
  const tone = Number(match[2]);
  const { initial, final: written } = splitInitial(base);

  let final = written;

  // Apical i: the syllabic nucleus is not ordinary /i/.
  if (final === "i" && APICAL_INITIALS.has(initial)) {
    return INITIAL_MAP[initial] + applyTone("ư", tone, tonesEnabled);
  }

  // Restore the /y/ vowel hidden by Pinyin spelling, rendered as yu.
  // j/q/x + u means /y/; nü/lü carry an explicit ü; zero-initial yuan hides it.
  // (The ü-led alternatives also cover already-restored input spellings.)
  if (JU_Q_X.has(initial)) {
    if (final === "u" || final === "ü") final = "yu";
    else if (final === "uan" || final === "üan") final = "yuen";
    else if (final === "ue" || final === "üe") final = "yue";
    else if (final === "un" || final === "ün") final = "yun";
  } else if (final.startsWith("ü")) {
    final = `yu${final.slice(1)}`;
  } else if (!initial && final === "yuan") {
    final = "yuen";
  }

  // Expand Pinyin contractions to the explicit final. Zero-initial wei is the
  // same uei family as consonant + ui, so it takes the same ê rendering.
  if (final === "iu") final = "iou";
  else if (final === "ui") final = "uei";
  else if (final === "wei") final = "wêi";
  else if (final === "un") final = "uen";
  else if (final === "wen") final = "wuân";
  else if (final === "weng") final = "wuâng";

  // Labial shorthand o -> uo family.
  if (final === "o" && LABIALS.has(initial)) final = "uo";

  // Locked final rewrites (terminals: ân/âng/uân/uâng/ien already explicit).
  // ê marks the closer /e/-like component in the ei/uei family; ie/ian keep
  // the opener e.
  if (final !== "wuân" && final !== "wuâng") {
    if (final === "e") final = "ơ";
    else if (final === "en") final = "ân";
    else if (final === "eng") final = "âng";
    else if (final === "ei") final = "êi";
    else if (final === "uei") final = "uêi";
    else if (final === "ian" || final === "yan") final = final.startsWith("y") ? "yien" : "ien";
    else if (final === "uen") final = "uân";
    else if (final === "ueng") final = "uâng";
  }

  const mappedInitial = initial ? (INITIAL_MAP[initial] ?? initial) : "";
  return mappedInitial + applyTone(final, tone, tonesEnabled);
}
