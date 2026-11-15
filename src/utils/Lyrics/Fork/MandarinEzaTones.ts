/**
 * Layer 3 of Mandarin eza式 revision 3: the written tone of tone 4 and of neutral syllables,
 * matching the cjk-labs reference (`src/languages/chinese/eza.ts`).
 *
 * A tone 4 before a tone 4, or before a neutral, is written flat (no mark), across words too.
 * A neutral after such a tone 4 takes the grave. Layers 2 and 3 use the digits 0 (neutral, no mark),
 * 6 (neutral grave) and 7 (neutral hook); 6 and 7 are eza式-internal and never reach Standard Pinyin.
 */
export const EZA_STYLE_REVISION = "eza-2026-11-15.3" as const;

/** Han numerals: 一二三, 十, 百, 千, 万, 亿 and 零. */
export const HAN_NUMERALS = "〇零一二三四五六七八九十百千万萬亿億两兩";

export function realizeNeutralTones(tones: readonly number[]): number[] {
  const out = tones.map((tone) => (tone === 5 ? 0 : tone));
  const base = out.slice();
  for (let index = 0; index + 1 < base.length; index++) {
    if (base[index] !== 4) continue;
    const next = base[index + 1];
    if (next === 4) out[index] = 1;
    else if (next === 0 || next === 6 || next === 7) { out[index] = 1; out[index + 1] = 6; }
  }
  return out;
}

/**
 * Layer 3 over a whole line: the tone-4 rule applies across words too, so it needs the line's adjacency.
 * A gap (punctuation or an unavailable reading) ends adjacency, just as it ends a sandhi run.
 */
export function realizeSurfaceTones(surface: readonly (readonly string[] | undefined)[]): readonly (readonly string[] | undefined)[] {
  const out = surface.map((own) => (own ? [...own] : undefined));
  let run: { token: number; at: number; letters: string; tone: number }[] = [];
  const flush = () => {
    const realized = realizeNeutralTones(run.map((entry) => entry.tone));
    run.forEach((entry, index) => { out[entry.token]![entry.at] = `${entry.letters}${realized[index]!}`; });
    run = [];
  };
  surface.forEach((own, token) => {
    if (!own) { flush(); return; }
    own.forEach((syllable, at) => {
      const match = /^([a-zü]+)([0-7])$/u.exec(syllable);
      if (!match) { flush(); return; }
      run.push({ token, at, letters: match[1]!, tone: Number(match[2]) });
    });
  });
  flush();
  return out;
}
