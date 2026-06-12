/**
 * Minimal Japanese lexical override dictionary.
 *
 * Keep entries only for verified tokenizer gaps or lyric readings the dictionary
 * cannot infer from surface alone. Normal compounds must defer to Kuromoji.
 */

export const JUKUJIKUN: Record<string, string> = {
  // IPADIC commonly splits bare counters as 一 + 人 / 二 + 人.
  "一人": "hitori",
  "二人": "futari",
  "1人": "hitori",
  "2人": "futari",

  // Lyric/pronoun plural reading. Regular 方 readings defer to dictionary.
  "貴方方": "anata gata",
  "君方": "kimi gata",
};

export function getJukujikun(text: string): string | undefined {
  return JUKUJIKUN[text];
}

export function hasJukujikun(text: string): boolean {
  return text in JUKUJIKUN;
}
