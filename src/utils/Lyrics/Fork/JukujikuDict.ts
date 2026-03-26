/**
 * Jukujikun (熟字訓) Dictionary
 * 
 * Compound kanji readings that kuromoji's ipadic dictionary may split incorrectly.
 * These are special readings where the pronunciation doesn't follow individual
 * character readings but instead represents the word as a whole.
 * 
 * @fork-feature Custom kanji romanization improvements
 */

export const JUKUJIKUN: Record<string, string> = {
  // People/counters
  "一人": "hitori",
  "二人": "futari",
  "大人": "otona",
  "素人": "shirouto",
  "玄人": "kurouto",
  "友達": "tomodachi",

  // Skill levels
  "下手": "heta",
  "上手": "jouzu",

  // Time expressions
  "今朝": "kesa",
  "明後日": "asatte",
  "昨日": "kinou",
  "今日": "kyou",
  "明日": "ashita",
  "一日": "tsuitachi",
  "二日": "futsuka",
  "三日": "mikka",

  // Objects/places
  "果物": "kudamono",
  "眼鏡": "megane",
  "部屋": "heya",
  "土産": "miyage",
  "時計": "tokei",

  // Nature
  "紅葉": "momiji",
  "景色": "keshiki",

  // Counters (hitotsu, futatsu, etc.)
  "一つ": "hitotsu",
  "二つ": "futatsu",
  "三つ": "mittsu",
  "四つ": "yottsu",
  "五つ": "itsutsu",
  "七つ": "nanatsu",
  "八つ": "yattsu",
  "九つ": "kokonotsu",
  "十": "tou",

  // Abstract/misc
  "日々": "hibi",
  "言葉": "kotoba",
  "何処": "doko",
  "何時": "itsu",
  "何故": "naze",
  "相応しい": "fusawashii",
};

/**
 * Look up a jukujikun reading for a given kanji compound.
 * Returns undefined if no special reading exists.
 */
export function getJukujikun(text: string): string | undefined {
  return JUKUJIKUN[text];
}

/**
 * Check if a compound has a jukujikun reading.
 */
export function hasJukujikun(text: string): boolean {
  return text in JUKUJIKUN;
}
