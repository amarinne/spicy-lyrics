/**
 * Cantonese VN/Latin-biased pronunciation-aid renderer.
 *
 * One-way display from Jyutping (onset + final + tone digit, as produced by
 * `walkCantoneseReadings`) into the locked aid spelling. No G2P: the input
 * Jyutping is already the pronunciation.
 *
 * Locked rules implemented here:
 * - onsets: d->t, t->th, g->k, k->kh, gw->qu, kw->khw (kho- before a/ă),
 *   z->z, c->ts, j->y (j + yu-family coalesces to single y)
 * - finals: aa->a / a->ă, aai->ai / ai->ay, aau->ao / au->au,
 *   final -k -> -c, eo-family -> ơ (+ plain o echo for the long member),
 *   oe-family -> ơo-family, yu-family kept as yu/yun/yut
 * - tones: T1 tilde, T2 acute, T3 unmarked, T4 grave, T5 hook, T6 dot below;
 *   traditional entering labels 7/8/9 fold to 1/3/6
 * - tone mark goes on the mapped nucleus (qu-/kho- glides never bear tone;
 *   the echo o in ơo stays plain); yu-family nucleus u does bear tone;
 *   syllabic m/ng carry the mark themselves
 */

export const CANTONESE_ONSET_MAP: Record<string, string> = {
  b: "b",
  p: "p",
  m: "m",
  f: "f",
  d: "t",
  t: "th",
  n: "n",
  l: "l",
  g: "k",
  k: "kh",
  ng: "ng",
  h: "h",
  gw: "qu",
  kw: "khw",
  w: "w",
  z: "z",
  c: "ts",
  s: "s",
  j: "y",
};

/** Combining marks per Jyutping tone: T1 tilde U+0303, T2 acute U+0301, T3 unmarked, T4 grave U+0300, T5 hook U+0309, T6 dot below U+0323. */
const TONE_MARKS: Record<number, string> = {
  1: "\u0303",
  2: "\u0301",
  3: "",
  4: "\u0300",
  5: "\u0309",
  6: "\u0323",
};

type FinalEntry = {
  /** Aid spelling of the final. */
  readonly aid: string;
  /**
   * Index (in aid-final chars) of the tone-bearing nucleus.
   * -1 marks a syllabic nasal: the mark goes on `m`, or on the `n` of `ng`.
   */
  readonly nucleus: number;
};

const FINAL_TABLE: Record<string, FinalEntry> = {
  aa: { aid: "a", nucleus: 0 },
  aai: { aid: "ai", nucleus: 0 },
  aau: { aid: "ao", nucleus: 0 },
  aam: { aid: "am", nucleus: 0 },
  aan: { aid: "an", nucleus: 0 },
  aang: { aid: "ang", nucleus: 0 },
  aap: { aid: "ap", nucleus: 0 },
  aat: { aid: "at", nucleus: 0 },
  aak: { aid: "ac", nucleus: 0 },
  a: { aid: "ă", nucleus: 0 },
  ai: { aid: "ay", nucleus: 0 },
  au: { aid: "au", nucleus: 0 },
  am: { aid: "ăm", nucleus: 0 },
  an: { aid: "ăn", nucleus: 0 },
  ang: { aid: "ăng", nucleus: 0 },
  ap: { aid: "ăp", nucleus: 0 },
  at: { aid: "ăt", nucleus: 0 },
  ak: { aid: "ăc", nucleus: 0 },
  e: { aid: "e", nucleus: 0 },
  ei: { aid: "ei", nucleus: 0 },
  eu: { aid: "eu", nucleus: 0 },
  em: { aid: "em", nucleus: 0 },
  eng: { aid: "eng", nucleus: 0 },
  ep: { aid: "ep", nucleus: 0 },
  ek: { aid: "ec", nucleus: 0 },
  i: { aid: "i", nucleus: 0 },
  iu: { aid: "iu", nucleus: 0 },
  im: { aid: "im", nucleus: 0 },
  in: { aid: "in", nucleus: 0 },
  ing: { aid: "ing", nucleus: 0 },
  ip: { aid: "ip", nucleus: 0 },
  it: { aid: "it", nucleus: 0 },
  ik: { aid: "ic", nucleus: 0 },
  o: { aid: "o", nucleus: 0 },
  oi: { aid: "oi", nucleus: 0 },
  ou: { aid: "ou", nucleus: 0 },
  on: { aid: "on", nucleus: 0 },
  ong: { aid: "ong", nucleus: 0 },
  ot: { aid: "ot", nucleus: 0 },
  ok: { aid: "oc", nucleus: 0 },
  oe: { aid: "ơo", nucleus: 0 },
  oeng: { aid: "ơong", nucleus: 0 },
  oet: { aid: "ơot", nucleus: 0 },
  oek: { aid: "ơoc", nucleus: 0 },
  eoi: { aid: "ơi", nucleus: 0 },
  eon: { aid: "ơn", nucleus: 0 },
  eot: { aid: "ơt", nucleus: 0 },
  u: { aid: "u", nucleus: 0 },
  ui: { aid: "ui", nucleus: 0 },
  un: { aid: "un", nucleus: 0 },
  ung: { aid: "ung", nucleus: 0 },
  ut: { aid: "ut", nucleus: 0 },
  uk: { aid: "uc", nucleus: 0 },
  yu: { aid: "yu", nucleus: 1 },
  yun: { aid: "yun", nucleus: 1 },
  yut: { aid: "yut", nucleus: 1 },
  m: { aid: "m", nucleus: -1 },
  ng: { aid: "ng", nucleus: -1 },
};

const YU_FAMILY = new Set(["yu", "yun", "yut"]);

function splitJyutpingBody(body: string): { onset: string; final: string } | undefined {
  if (body === "m" || body === "ng") return { onset: "", final: body };
  for (const onset of ["gw", "kw", "ng"]) {
    if (body.startsWith(onset) && FINAL_TABLE[body.slice(onset.length)]) {
      return { onset, final: body.slice(onset.length) };
    }
  }
  const first = body[0] ?? "";
  if (first && "bpmfdtnlgkhwzcsj".includes(first) && FINAL_TABLE[body.slice(1)]) {
    return { onset: first, final: body.slice(1) };
  }
  if (FINAL_TABLE[body]) return { onset: "", final: body };
  return undefined;
}

/**
 * Convert one Jyutping syllable (e.g. "soeng5", "gwong2", "jyu6", "m4",
 * toneless "nei") into the aid spelling. Traditional entering-tone labels
 * 7/8/9 fold to 1/3/6. Unparseable input passes through.
 */
export function convertJyutpingSyllableToVnAid(syllable: string, tonesEnabled = true): string {
  const input = (syllable || "").normalize("NFKC").trim().toLowerCase();
  if (!input) return syllable;
  let tone = 0;
  let body = input;
  const last = input[input.length - 1];
  if (last >= "1" && last <= "9") {
    tone = last === "7" ? 1 : last === "8" ? 3 : last === "9" ? 6 : Number(last);
    body = input.slice(0, -1);
  }
  const parsed = splitJyutpingBody(body);
  if (!parsed) return syllable;
  const entry = FINAL_TABLE[parsed.final];
  if (!entry) return syllable;

  // j + yu-family coalesces: the onset glide and the final y merge to one.
  if (parsed.onset === "j" && YU_FAMILY.has(parsed.final)) {
    return applyToneToFinal(entry.aid, entry.nucleus, tone, tonesEnabled);
  }

  let onsetAid = CANTONESE_ONSET_MAP[parsed.onset] ?? parsed.onset;
  // Contextual kho- presentation: aspirated labiovelar before the a/ă family
  // reads cleaner as kho-; other finals keep explicit khw-.
  if (parsed.onset === "kw" && /^[aă]/.test(entry.aid)) {
    onsetAid = "kho";
  }

  const marked = applyToneToFinal(entry.aid, entry.nucleus, tone, tonesEnabled);
  return onsetAid + marked;
}

function applyToneToFinal(aidFinal: string, nucleus: number, tone: number, tonesEnabled: boolean): string {
  if (!tonesEnabled || tone === 3 || tone === 0) return aidFinal;
  const mark = TONE_MARKS[tone] ?? "";
  if (!mark) return aidFinal;
  const chars = Array.from(aidFinal);
  if (nucleus < 0) {
    // Syllabic nasal: the mark goes on m, or on the n component of ng.
    // Both spellings start with the mark-bearing letter, so index 0 is right.
    chars[0] = (chars[0] + mark).normalize("NFC");
    return chars.join("");
  }
  if (nucleus >= chars.length) return aidFinal;
  chars[nucleus] = (chars[nucleus] + mark).normalize("NFC");
  return chars.join("");
}
