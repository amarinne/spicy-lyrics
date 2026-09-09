/**
 * Thai VN-aid pronunciation renderer.
 *
 * One-way display from detailed phonemic IPA (as produced by a Thai
 * pronunciation backend; FastThaiG2P is the preferred reference) into the
 * locked Vietnamese-informed aid spelling. This module is NOT a Thai G2P
 * engine: it consumes resolved pronunciation and renders it.
 *
 * Backend contract: see `ThaiPronunciationBackend` below. No backend is
 * bundled here; the renderer and its tests run against captured/reference
 * IPA outputs until an embeddable backend exists.
 *
 * Locked rules implemented here:
 * - surface phonemes, not spelling history: d stays d (no Mandarin-style
 *   d->t correction); aspirates ph/th/kh stay explicit.
 * - intentional ch merger: /tɕ/ and /tɕʰ/ (also tʃ variants) -> ch.
 * - nine monophthong qualities with plain-echo length:
 *   i/ii, ư/ưu, u/uu, ê/êe, ơ/ơo, ô/ôo, e/ee, a/aa, o/oo.
 * - core diphthongs ia/ưa/ua, plus long-first-element iia/uua/ưua when the
 *   backend distinguishes them.
 * - surface codas m/n/ng/p/t/k (+ y/w final glides); Thai keeps final -k.
 * - tones: mid unmarked, low grave, falling tilde, high acute, rising hook;
 *   always on the first (quality-bearing) vowel, echo stays plain.
 * - FastThaiG2P-style Chao tone letters normalize to the five categories.
 *
 * Implementation-defined (flagged, not locked by the spec):
 * - Thai consonant clusters (Cr/Cl/Cw, e.g. /kʰruː/) render compositionally
 *   as aid-onset + glide (khruu); the spec inventory lists singletons only.
 * - a glottal-stop coda (ʔ) is dropped: the short (echo-less) vowel already
 *   carries that information in this system.
 * - a leading glottal-stop onset (ʔ, the phonetic zero onset) is dropped.
 */

export type ThaiTone = "mid" | "low" | "falling" | "high" | "rising";

/**
 * Adapter interface for a Thai pronunciation backend. The preferred reference
 * is FastThaiG2P detailed IPA; any backend resolving to per-syllable IPA
 * strings (with Chao tone letters or a resolved tone category) can plug in.
 * The renderer never recomputes Thai orthographic tone rules when resolved
 * pronunciation is supplied.
 */
export type ThaiPronunciationBackend = {
  readonly name: string;
  transcribeToIpa(text: string): Promise<readonly string[]> | readonly string[];
};

const CHAO_MID = "˧";
const CHAO_LOW = "˨˩";
const CHAO_FALLING = "˥˩";
const CHAO_HIGH = "˦˥";
const CHAO_RISING = "˩˩˦";

const CHAO_TONE_MAP: Record<string, ThaiTone> = {
  [CHAO_MID]: "mid",
  [CHAO_LOW]: "low",
  [CHAO_FALLING]: "falling",
  [CHAO_HIGH]: "high",
  [CHAO_RISING]: "rising",
};

/** Combining marks per Thai tone: low grave U+0300, falling tilde U+0303, high acute U+0301, rising hook U+0309. Mid is the unmarked baseline. */
const TONE_MARKS: Record<ThaiTone, string> = {
  mid: "",
  low: "\u0300",
  falling: "\u0303",
  high: "\u0301",
  rising: "\u0309",
};

const ONSET_MAP: Record<string, string> = {
  b: "b",
  p: "p",
  "pʰ": "ph",
  d: "d",
  t: "t",
  "tʰ": "th",
  k: "k",
  "kʰ": "kh",
  "tɕ": "ch",
  "tɕʰ": "ch",
  tʃ: "ch",
  "tʃʰ": "ch",
  m: "m",
  n: "n",
  "ŋ": "ng",
  f: "f",
  s: "s",
  h: "h",
  r: "r",
  l: "l",
  w: "w",
  j: "y",
};

// Longest-first so aspirates/affricates match before their plain prefixes.
const ONSET_KEYS = Object.keys(ONSET_MAP).sort((a, b) => b.length - a.length);

const CLUSTER_FIRST = new Set(["p", "pʰ", "t", "tʰ", "k", "kʰ"]);
const CLUSTER_GLIDES = new Set(["r", "l", "w"]);

const NUCLEUS_MAP: Record<string, string> = {
  "iː": "ii",
  i: "i",
  "ɯː": "ưu",
  "ɯ": "ư",
  "uː": "uu",
  u: "u",
  "eː": "êe",
  e: "ê",
  "ɤː": "ơo",
  "ɤ": "ơ",
  "oː": "ôo",
  o: "ô",
  "ɛː": "ee",
  "ɛ": "e",
  "aː": "aa",
  a: "a",
  "ɔː": "oo",
  "ɔ": "o",
  "iːa": "iia",
  ia: "ia",
  "ɯːa": "ưua",
  "ɯa": "ưa",
  "uːa": "uua",
  ua: "ua",
};

const NUCLEUS_KEYS = Object.keys(NUCLEUS_MAP).sort((a, b) => b.length - a.length);

const CODA_MAP: Record<string, string> = {
  m: "m",
  n: "n",
  "ŋ": "ng",
  p: "p",
  t: "t",
  k: "k",
  j: "y",
  w: "w",
};

const CHAO_LETTERS = new Set(["˧", "˨", "˩", "˥", "˦"]);

type ParsedThaiSyllable = {
  readonly onset: string;
  readonly nucleus: string;
  readonly coda: string;
  readonly tone: ThaiTone | undefined;
  /** True when the input carried an explicit but unrecognized tone contour. */
  readonly unknownTone: boolean;
};

function parseThaiIpaSyllable(clean: string): ParsedThaiSyllable | undefined {
  let rest = clean;
  let tone: ThaiTone | undefined;
  let unknownTone = false;

  // Trailing Chao tone-letter run (up to 3 contour elements).
  let chaoRun = "";
  while (rest.length > 0 && CHAO_LETTERS.has(rest[rest.length - 1])) {
    chaoRun = rest[rest.length - 1] + chaoRun;
    rest = rest.slice(0, -1);
  }
  if (chaoRun) {
    tone = CHAO_TONE_MAP[chaoRun];
    if (!tone) unknownTone = true;
  }

  // The coda is resolved after nucleus matching: whatever remains once
  // onset + nucleus have matched must be a single surface final (a glottal
  // stop carries no aid spelling and is dropped).
  let coda = "";

  // Onset: longest inventory match, optional cluster glide, dropped ʔ onset.
  let onset = "";
  if (rest.startsWith("ʔ")) rest = rest.slice(1);
  for (const key of ONSET_KEYS) {
    if (rest.startsWith(key)) {
      onset = key;
      rest = rest.slice(key.length);
      break;
    }
  }
  // If no inventory onset matched, the syllable is vowel-initial.
  if (onset) {
    // Cluster second element (implementation-defined compositional rendering).
    if (CLUSTER_FIRST.has(onset) && CLUSTER_GLIDES.has(rest[0] ?? "")) {
      const afterGlide = rest.slice(1);
      if (NUCLEUS_KEYS.some((n) => afterGlide.startsWith(n))) {
        onset += rest[0];
        rest = afterGlide;
      }
    }
  }

  // Nucleus: longest match at the current head.
  let nucleus = "";
  for (const key of NUCLEUS_KEYS) {
    if (rest.startsWith(key)) {
      nucleus = key;
      rest = rest.slice(key.length);
      break;
    }
  }
  if (!nucleus) return undefined;

  // Whatever remains must be the coda (or nothing).
  if (rest.length > 0) {
    if (rest === "ʔ") {
      rest = "";
    } else if (rest.length === 1 && CODA_MAP[rest]) {
      coda = rest;
      rest = "";
    } else {
      return undefined;
    }
  }

  return { onset, nucleus, coda, tone, unknownTone };
}

function renderOnset(onset: string): string {
  if (!onset) return "";
  // Cluster: aid spelling of the first consonant + the glide letter.
  if (onset.length > 1 && !ONSET_MAP[onset]) {
    const first = Object.keys(ONSET_MAP)
      .sort((a, b) => b.length - a.length)
      .find((key) => onset.startsWith(key));
    if (first) return (ONSET_MAP[first] ?? first) + onset.slice(first.length);
  }
  return ONSET_MAP[onset] ?? "";
}

/**
 * Convert one Thai IPA syllable (e.g. "maː˧", "kʰruː˩˩˦", "/tɕʰa˥˩/")
 * into the aid spelling. Slashes and surrounding whitespace are ignored.
 * Unparseable input (or an unrecognized explicit tone contour) passes
 * through unchanged rather than guessing.
 */
export function convertThaiIpaSyllableToVnAid(ipaSyllable: string, tonesEnabled = true): string {
  const input = ipaSyllable || "";
  const clean = input.trim().replace(/^\/+|\/+$/g, "").replace(/\s+/g, "");
  if (!clean) return input;
  const parsed = parseThaiIpaSyllable(clean);
  if (!parsed || parsed.unknownTone) return input;

  const nucleus = NUCLEUS_MAP[parsed.nucleus] ?? "";
  if (!nucleus) return input;
  const onset = renderOnset(parsed.onset);
  if (parsed.onset && !onset) return input;
  const coda = parsed.coda ? (CODA_MAP[parsed.coda] ?? "") : "";
  if (parsed.coda && !coda && parsed.coda !== "ʔ") return input;

  const tone: ThaiTone = parsed.tone ?? "mid";
  const mark = tonesEnabled ? (TONE_MARKS[tone] ?? "") : "";
  const chars = Array.from(nucleus);
  // Tone always goes on the first, quality-bearing vowel; echo stays plain.
  if (mark) chars[0] = (chars[0] + mark).normalize("NFC");
  return (onset + chars.join("") + coda).normalize("NFC");
}

/**
 * Convenience splitter for reference transcriptions: syllables separated by
 * whitespace and/or middle dots. Each syllable converts independently.
 */
export function convertThaiIpaLineToVnAid(ipaLine: string, tonesEnabled = true): string {
  return (ipaLine || "")
    .split(/[\s·.]+/u)
    .filter(Boolean)
    .map((syllable) => convertThaiIpaSyllableToVnAid(syllable, tonesEnabled))
    .join(" ");
}
