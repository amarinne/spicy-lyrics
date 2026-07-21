/**
 * Romanization Functions
 * 
 * Custom romanization implementations for various writing systems.
 * Extends upstream's basic romanization with:
 * - Cantonese Jyutping support
 * - Improved Cyrillic BGN/PCGN transliteration
 * - Fallback romaji builder for Japanese
 * 
 * @fork-feature Extended romanization support
 */

import type Kuroshiro from "kuroshiro";
import transliterPkg from "transliter";
import { getJyutpingList } from "to-jyutping";
import { G2p } from "korean-pronunciation";
import { hasUnromanizedKanji, ChineseTextTest } from "./TextDetection.ts";
import { analyzeJapaneseLine, JapaneseSourceTextTest } from "../Reading/JapaneseReading.ts";

const JYUTPING_PHRASES: Record<string, string> = {
  上堂: "soeng5 tong4",
  終於: "zung1 jyu1",
  講到: "gong2 dou3",
  分數: "fan1 sou3",
  好學生: "hou2 hok6 saang1",
  好學: "hou3 hok6",
  學生: "hok6 saang1",
  老世: "lou5 sai3",
  要求: "jiu1 kau4",
  等陣: "dang2 zan6",
  看著: "hon3 zyu6",
  望著: "mong6 zyu6",
  想著: "soeng2 zyu6",
  等著: "dang2 zyu6",
  跟著: "gan1 zyu6",
  數數: "sou2 sou3",
  開會: "hoi1 wui2",
  剩低: "zing6 dai1",
  搞掂: "gaau2 dim6",
  嘅嘢: "ge3 je5",
  㗎喇: "gaa3 laa3",
  香港: "hoeng1 gong2",
  廣東話: "gwong2 dung1 waa2",
  冇問題: "mou5 man6 tai4",
  唔知道: "m4 zi1 dou3",
  鍾意: "zung1 ji3",
  點解: "dim2 gaai2",
  今日: "gam1 jat6",
  聽日: "ting1 jat6",
  琴日: "kam4 jat6",
  乜嘢: "mat1 je5",
  係咪: "hai6 mai6",
  唔係: "m4 hai6",
  可以: "ho2 ji5",
  如果: "jyu4 gwo2",
  因為: "jan1 wai6",
  所以: "so2 ji5",
  一齊: "jat1 cai4",
  返嚟: "faan1 lai4",
  出去: "ceot1 heoi3",
  入嚟: "jap6 lai4",
  屋企: "uk1 kei2",
  自己: "zi6 gei2",
  大家: "daai6 gaa1",
  我哋: "ngo5 dei6",
  你哋: "nei5 dei6",
  佢哋: "keoi5 dei6",
};

const JYUTPING_PHRASE_KEYS = Object.keys(JYUTPING_PHRASES).sort((a, b) => b.length - a.length);
const LatinTextTest = /[A-Za-z]/;

// ─── Cantonese (Jyutping) ─────────────────────────────────────────────────────

function isChineseHanChar(char: string): boolean {
  return ChineseTextTest.test(char);
}

/**
 * Romanize Chinese text using Cantonese Jyutping.
 * Uses phrase overrides before falling back to to-jyutping for Han characters.
 */
export async function romanizeCantonese(
  text: string,
  primaryLanguage: string,
  skipTextTests: boolean,
  tones = true
): Promise<string | undefined> {
  if (primaryLanguage !== "cmn" && primaryLanguage !== "yue" && !skipTextTests && !ChineseTextTest.test(text)) {
    return undefined;
  }

  const parts: string[] = [];
  for (let index = 0; index < text.length;) {
    const phrase = JYUTPING_PHRASE_KEYS.find((key) => text.startsWith(key, index));
    if (phrase) {
      const reading = JYUTPING_PHRASES[phrase];
      parts.push(tones ? reading : stripJyutpingTones(reading));
      index += phrase.length;
      continue;
    }

    const char = Array.from(text.slice(index))[0];
    if (!isChineseHanChar(char)) {
      let end = index + char.length;
      while (end < text.length) {
        const nextPhrase = JYUTPING_PHRASE_KEYS.some((key) => text.startsWith(key, end));
        const nextChar = Array.from(text.slice(end))[0];
        if (nextPhrase || isChineseHanChar(nextChar)) break;
        end += nextChar.length;
      }

      const span = text.slice(index, end).trim();
      if (span) parts.push(span);
      index = end;
      continue;
    }

    const list = getJyutpingList(char);
    const reading = list?.[0]?.[1] || char;
    if (reading.trim()) parts.push(tones ? reading : stripJyutpingTones(reading));
    index += char.length;
  }

  const result = parts.join(" ").replace(/\s+/g, " ").trim();
  return result || undefined;
}

export function stripJyutpingTones(text: string): string {
  return text.replace(/(?<=[a-zA-Z])[1-6]/g, "");
}

export function pinyinOptionsForToneMode(pinyin: any, tones: boolean): Record<string, any> {
  // segment:true resolves polyphones via the package's word segmentation
  // (音乐→yuè, 银行→háng, 一切→qiè); group:false keeps one syllable per Han
  // char so karaoke syllable alignment survives. Verified against the CDN
  // artifact pkgs.spikerko.org/pinyin/pinyin@4.0.0.mjs (2026-07-06).
  const options: Record<string, any> = { segment: true, group: false };
  const style = tones ? pinyin?.STYLE_TONE : pinyin?.STYLE_NORMAL;
  if (style !== undefined) options.style = style;
  return options;
}

// ─── Cyrillic (BGN/PCGN) ──────────────────────────────────────────────────────

export type CyrillicMode = "Russian" | "Ukrainian";

function ukrainianLetter(char: string): string | undefined {
  switch (char) {
    case "г": return "h";
    case "Г": return "H";
    case "ґ": return "g";
    case "Ґ": return "G";
    case "и": return "y";
    case "И": return "Y";
    case "і": return "i";
    case "І": return "I";
    case "ї": return "yi";
    case "Ї": return "Yi";
    case "є": return "ye";
    case "Є": return "Ye";
    default: return undefined;
  }
}

function centralAsianCyrillicLetter(char: string): string | undefined {
  switch (char) {
    case "ң": return "ng";
    case "Ң": return "Ng";
    case "ө": return "o";
    case "Ө": return "O";
    case "ү": return "u";
    case "Ү": return "U";
    case "ә": return "a";
    case "Ә": return "A";
    case "ғ": return "gh";
    case "Ғ": return "Gh";
    case "қ": return "q";
    case "Қ": return "Q";
    case "ұ": return "u";
    case "Ұ": return "U";
    case "һ": return "h";
    case "Һ": return "H";
    case "ѳ": return "f";
    case "Ѳ": return "F";
    default: return undefined;
  }
}

function isCyrillicSource(char: string): boolean {
  const cp = char.codePointAt(0) ?? 0;
  return (cp >= 0x0400 && cp <= 0x04FF) || (cp >= 0x0500 && cp <= 0x052F);
}

function isRussianYeTrigger(char: string | null): boolean {
  return char == null || /[аеёиоуыэюяйъьАЕЁИОУЫЭЮЯЙЪЬ]/.test(char);
}

function normalizeCyrillicAscii(value: string): string {
  return value
    .replace(/Ë/g, "Yo").replace(/ë/g, "yo")
    .replace(/ǵ/g, "g").replace(/Ǵ/g, "G")
    .replace(/ḱ/g, "k").replace(/Ḱ/g, "K")
    .replace(/ẑ/g, "dz").replace(/Ẑ/g, "Dz")
    .replace(/ì/g, "i").replace(/đ/g, "dj").replace(/Đ/g, "Dj")
    .replace(/ć/g, "c").replace(/Ć/g, "C")
    .replace(/ž/g, "zh").replace(/Ž/g, "Zh")
    .replace(/dž/g, "dzh").replace(/Dž/g, "Dzh");
}

function mapCyrillic(char: string, prevCyrillic: string | null, mode: CyrillicMode, keepSigns: boolean): string {
  if (char === "ъ" || char === "Ъ") return keepSigns ? "ʺ" : "";
  if (char === "ь" || char === "Ь") return keepSigns ? "ʹ" : "";

  const centralAsianMapped = centralAsianCyrillicLetter(char);
  if (centralAsianMapped) return centralAsianMapped;

  if (mode === "Ukrainian") {
    const mapped = ukrainianLetter(char);
    if (mapped) return mapped;
    if (char === "е") return "e";
    if (char === "Е") return "E";
  } else {
    if (char === "е") return isRussianYeTrigger(prevCyrillic) ? "ye" : "e";
    if (char === "Е") return isRussianYeTrigger(prevCyrillic) ? "Ye" : "E";
  }

  return normalizeCyrillicAscii(transliterPkg.transliter(char, "bgn-pcgn") ?? char);
}

/**
 * Romanize Cyrillic text with Russian BGN/PCGN defaults plus Android-port
 * options for Ukrainian letter values and hard/soft sign preservation.
 */
export function romanizeCyrillic(
  text: string,
  mode: CyrillicMode = "Russian",
  keepSigns: boolean = false
): string {
  let result = "";
  let prevCyrillic: string | null = null;
  for (const char of text) {
    if (isCyrillicSource(char)) {
      result += mapCyrillic(char, prevCyrillic, mode, keepSigns);
      prevCyrillic = char;
    } else {
      if (/\s/.test(char)) prevCyrillic = null;
      result += char;
    }
  }
  return result;
}

// ─── Korean (spelling + pronunciation) ────────────────────────────────────────

export type KoreanMode = "spelling" | "pronunciation";
export type KoreanOutputStyle = "rr" | "vn";
export type KoreanDisplayMode = "wordTranslit" | "rrStandard" | "rrPronunciation" | "vnPronunciation";
export type KoreanSyllableLike = { Text?: string; IsPartOfWord?: boolean };
export type KoreanRomanizeResult = {
  source: string;
  display: string;
  pronouncedHangul?: string;
  syllablePieces?: string[];
};

const HANGUL_INITIAL = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const HANGUL_VOWEL = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
const HANGUL_FINAL = ["", "k", "k", "ks", "n", "nj", "nh", "t", "l", "lk", "lm", "lb", "ls", "lt", "lp", "lh", "m", "p", "ps", "t", "t", "ng", "t", "t", "k", "t", "p", "t"];
const HANGUL_VOWEL_VN = ["a", "ê", "ya", "yê", "o", "ê", "yo", "yê", "ô", "wa", "wê", "wê", "yô", "u", "wo", "wê", "wi", "yu", "ư", "ưi", "i"];

const KOREAN_EOJEOL_REJOIN_WORDS = [
  "뒤돌아서", "너를", "없게", "없어", "이상", "기댈", "곳은", "필요",
  "어떻게든", "호기심은", "위험하단", "희미해져", "돌아갈",
  "모습이", "없을", "없이", "거야", "너는", "주저", "감출", "있게", "날아가", "멀리", "나로", "다시", "점점", "날", "내", "수", "걸",
  "말도", "하지", "마요", "미련이", "아냐", "그저", "처음부터", "잘못됐단",
] as const;
const KOREAN_EOJEOL_REJOIN_KEYS = [...KOREAN_EOJEOL_REJOIN_WORDS].sort((a, b) => b.length - a.length);
const KOREAN_DEPENDENT_NOUNS_AFTER_L = new Set(["수", "것", "곳", "때", "거", "거야", "게", "줄", "지", "데", "리", "만큼", "뻔", "적"]);
const KOREAN_POST_G2P_EXCEPTIONS: Record<string, string> = {
  앉다: "안따",
  읽고: "일꼬",
  맑게: "말께",
  젊다: "점따",
  밟다: "밥따",
  핥다: "할따",
  눈빛: "눈삗",
  문법: "문뻡",
  발달: "발딸",
  뒷일: "뒨닐",
};
const KOREAN_POST_G2P_PHRASE_EXCEPTIONS: Record<string, string[]> = {
  "갈 데가": ["갈", "떼가"],
};
const KOREAN_LEXICAL_UI_WORDS = new Set(["주의", "의미", "회의", "거의"]);
const KOREAN_COMMON_RR_OVERRIDES: Record<string, string> = { 독립문: "dongnimmun" };
const CODA_LIAISON_RR: Record<number, string> = { 1: "g", 2: "kk", 3: "ks", 4: "n", 5: "nj", 6: "nh", 7: "d", 8: "r", 9: "lg", 10: "lm", 11: "lb", 12: "ls", 13: "lt", 14: "lp", 15: "lh", 16: "m", 17: "b", 18: "bs", 19: "s", 20: "ss", 21: "ng", 22: "j", 23: "ch", 24: "k", 25: "t", 26: "p", 27: "h" };

const CODA_ROMAN: Record<number, string> = { 0: "", 1: "k", 4: "n", 7: "t", 8: "l", 16: "m", 17: "p", 21: "ng" };

const NUC_I = 20;
const NUC_UI = 19;
const CODA_NONE = 0;
const CODA_G = 1;
const CODA_L = 8;
const ON_R = 5;
const ON_NULL = 11;
const LatinWordTextTest = /[A-Za-zÀ-ÖØ-öø-ÿĀ-žƀ-ɏ]/;

let koreanG2p: G2p | undefined;

type HangulSyllable = [number, number, number];
type KoreanRomanizedSyllablePart = { onset: string; vowel: string; coda: string };

function decomposeHangul(char: string): HangulSyllable | null {
  const cp = char.codePointAt(0) ?? 0;
  if (cp < 0xAC00 || cp > 0xD7A3) return null;
  const s = cp - 0xAC00;
  return [Math.floor(s / 588), Math.floor((s % 588) / 28), s % 28];
}

function isHangulSyllable(char: string): boolean {
  return decomposeHangul(char) !== null;
}

function getKoreanG2p(): G2p {
  koreanG2p ??= new G2p();
  return koreanG2p;
}

function appendLineSpaceIfNeeded(lineText: string): string {
  return lineText && !/\s$/.test(lineText) ? `${lineText} ` : lineText;
}

function isSingleHangulToken(token: string): boolean {
  return Array.from(token).length === 1 && isHangulSyllable(token);
}

function isHangulToken(token: string): boolean {
  return Array.from(token).every(isHangulSyllable);
}

function rejoinKnownKoreanWords(text: string): string {
  let out = text;
  for (const word of KOREAN_EOJEOL_REJOIN_KEYS) {
    if (Array.from(word).length < 2) continue;
    const pattern = new RegExp(Array.from(word).join("\\s+"), "g");
    out = out.replace(pattern, word);
  }
  return out;
}

function normalizeKoreanTokenizerSpacing(text: string): string {
  text = rejoinKnownKoreanWords(text);
  const tokens = text.trim().split(/\s+/);
  if (tokens.length < 2 || !tokens.some(isSingleHangulToken)) return text;

  const out: string[] = [];
  for (let index = 0; index < tokens.length;) {
    if (!isHangulToken(tokens[index])) {
      out.push(tokens[index]);
      index += 1;
      continue;
    }

    let match = "";
    let consumed = 0;
    for (const word of KOREAN_EOJEOL_REJOIN_KEYS) {
      let combined = "";
      for (let offset = 0; index + offset < tokens.length; offset += 1) {
        const token = tokens[index + offset];
        if (!isHangulToken(token)) break;
        combined += token;
        if (!word.startsWith(combined)) break;
        if (combined === word) {
          match = word;
          consumed = offset + 1;
          break;
        }
      }
      if (match) break;
    }

    if (match) {
      out.push(match);
      index += consumed;
      continue;
    }

    out.push(tokens[index]);
    index += 1;
  }

  return out.join(" ");
}

function normalizeKoreanBuiltLineText(text: string): string {
  return text
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?])(?=\S)/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildKoreanLineTextWithLeadingBoundaries(syllables: KoreanSyllableLike[]): string {
  let lineText = "";
  for (let index = 0; index < syllables.length; index += 1) {
    const text = syllables[index]?.Text || "";
    if (!text) continue;
    if (lineText && syllables[index]?.IsPartOfWord !== true) lineText += " ";
    lineText += text.trim();
  }
  return normalizeKoreanBuiltLineText(lineText);
}

function buildKoreanLineTextWithTrailingBoundaries(syllables: KoreanSyllableLike[]): string {
  let lineText = "";
  for (let index = 0; index < syllables.length; index += 1) {
    const text = syllables[index]?.Text || "";
    if (!text) continue;
    lineText += text.trim();
    if (index < syllables.length - 1 && syllables[index]?.IsPartOfWord !== true) lineText += " ";
  }
  return normalizeKoreanBuiltLineText(lineText);
}

function buildKoreanLineTextWithSmartBoundaries(syllables: KoreanSyllableLike[]): string {
  const suffixLike = /^(?:이|가|은|는|을|를|도|에|의|로|와|과|만|뿐|요|죠|지|네|군|까|고|게|면서)$/;
  let lineText = "";
  let previous = "";

  for (const syllable of syllables) {
    const text = (syllable?.Text || "").trim();
    if (!text) continue;

    const previousIsLatin = LatinWordTextTest.test(previous);
    const currentIsLatin = LatinWordTextTest.test(text);
    const attachToPrevious =
      !lineText ||
      /^[,.;:!?]$/.test(text) ||
      (isHangulToken(previous) && isHangulToken(text) && suffixLike.test(text));

    if (!attachToPrevious || previousIsLatin || currentIsLatin) lineText = appendLineSpaceIfNeeded(lineText);
    lineText += text;
    previous = text;
  }

  return normalizeKoreanBuiltLineText(normalizeKoreanMixedScriptSpacing(lineText));
}

function scoreKoreanLineSpacing(text: string): number {
  const suffixLike = /^(?:이|가|은|는|을|를|도|에|의|로|와|과|만|뿐|요|죠|지|네|군|까|고|게|면서)$/;
  let score = 0;
  for (const token of text.split(/\s+/)) {
    if (!token) continue;
    if (!isHangulToken(token)) continue;
    const chars = Array.from(token);
    if (chars.length === 1) score += 20;
    if (suffixLike.test(token)) score += 12;
  }
  return score;
}

function normalizeKoreanMixedScriptSpacing(text: string): string {
  return text
    .replace(/([가-힯])([A-Za-zÀ-ÖØ-öø-ÿĀ-žƀ-ɏ])/g, "$1 $2")
    .replace(/([A-Za-zÀ-ÖØ-öø-ÿĀ-žƀ-ɏ])([가-힯])/g, "$1 $2")
    .replace(/([,.;:!?])(?=\S)/g, "$1 ");
}

export function buildKoreanLineTextFromSyllables(syllables: KoreanSyllableLike[]): string {
  if (syllables.some((syllable) => /\s/.test(syllable?.Text || ""))) {
    const rawJoined = normalizeKoreanBuiltLineText(normalizeKoreanMixedScriptSpacing(syllables.map((syllable) => syllable?.Text || "").join("")));
    const spanSpaced = normalizeKoreanBuiltLineText(
      syllables.map((syllable) => (syllable?.Text || "").trim()).filter(Boolean).join(" ")
    );
    const tokenizerSpaced = normalizeKoreanBuiltLineText(normalizeKoreanTokenizerSpacing(spanSpaced));
    return scoreKoreanLineSpacing(tokenizerSpaced) <= scoreKoreanLineSpacing(rawJoined) ? tokenizerSpaced : rawJoined;
  }

  const leading = buildKoreanLineTextWithLeadingBoundaries(syllables);
  const trailing = buildKoreanLineTextWithTrailingBoundaries(syllables);
  const hasContinuation = syllables.some((syllable) => syllable?.IsPartOfWord === true);
  const hasBoundary = syllables.some((syllable) => syllable?.IsPartOfWord === false);
  if (hasContinuation && hasBoundary) return normalizeKoreanMixedScriptSpacing(trailing);

  const spaced = normalizeKoreanBuiltLineText(
    syllables.map((syllable) => (syllable?.Text || "").trim()).filter(Boolean).join(" ")
  );
  const tokenizerSpaced = normalizeKoreanBuiltLineText(normalizeKoreanTokenizerSpacing(spaced));
  const smart = buildKoreanLineTextWithSmartBoundaries(syllables);
  const compactBest = scoreKoreanLineSpacing(trailing) < scoreKoreanLineSpacing(leading) ? trailing : leading;
  const spanTexts = syllables.map((syllable) => (syllable?.Text || "").trim()).filter(Boolean);
  const looksWordLevel = spanTexts.some((text) => LatinWordTextTest.test(text) || Array.from(text).length > 1);
  if (tokenizerSpaced !== spaced && scoreKoreanLineSpacing(tokenizerSpaced) < scoreKoreanLineSpacing(compactBest)) return tokenizerSpaced;
  if (looksWordLevel && /\s/.test(smart)) return smart;
  return scoreKoreanLineSpacing(spaced) + 8 < scoreKoreanLineSpacing(compactBest) ? spaced : normalizeKoreanMixedScriptSpacing(compactBest);
}

export function normalizeKoreanDisplaySource(text: string): string {
  const source = buildKoreanLineTextFromSyllables([{ Text: text, IsPartOfWord: false }]);
  return normalizeKoreanTokenizerSpacing(source);
}

export function romanizeKoreanSyllableLine(
  syllables: KoreanSyllableLike[],
  mode: KoreanMode = "spelling",
  style: KoreanOutputStyle = "rr",
  separators = false
): string {
  return romanizeKorean(buildKoreanLineTextFromSyllables(syllables), mode, style, separators);
}

function koreanVowel(syllable: HangulSyllable, style: KoreanOutputStyle): string {
  return style === "vn" ? HANGUL_VOWEL_VN[syllable[1]] : HANGUL_VOWEL[syllable[1]];
}

function koreanSpellingCoda(syllable: HangulSyllable, next: HangulSyllable | null, style: KoreanOutputStyle): string {
  if (style === "vn" && syllable[2] === CODA_G && next?.[0] === ON_NULL) return "g";
  return HANGUL_FINAL[syllable[2]];
}

function romanizeKoreanSpelling(text: string, style: KoreanOutputStyle): string {
  let out = "";
  const chars = Array.from(text);
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    const syl = decomposeHangul(char);
    const next = chars[index + 1] ? decomposeHangul(chars[index + 1]) : null;
    out += syl ? HANGUL_INITIAL[syl[0]] + koreanVowel(syl, style) + koreanSpellingCoda(syl, next, style) : char;
  }
  return out;
}

export function romanizeKoreanCommonRr(text: string): string {
  let out = "";
  const chars = Array.from(text);
  for (let index = 0; index < chars.length; index += 1) {
    const remaining = chars.slice(index).join("");
    const override = Object.entries(KOREAN_COMMON_RR_OVERRIDES).find(([word]) => remaining.startsWith(word));
    if (override) {
      out += override[1];
      index += Array.from(override[0]).length - 1;
      continue;
    }

    const syl = decomposeHangul(chars[index]);
    if (!syl) {
      out += chars[index];
      continue;
    }

    const next = chars[index + 1] ? decomposeHangul(chars[index + 1]) : null;
    if (syl[2] !== CODA_NONE && next?.[0] === ON_NULL) {
      out += HANGUL_INITIAL[syl[0]] + HANGUL_VOWEL[syl[1]];
      next[0] = -1;
      out += (CODA_LIAISON_RR[syl[2]] ?? HANGUL_FINAL[syl[2]]) + HANGUL_VOWEL[next[1]] + HANGUL_FINAL[next[2]];
      index += 1;
      continue;
    }

    out += HANGUL_INITIAL[syl[0]] + HANGUL_VOWEL[syl[1]] + HANGUL_FINAL[syl[2]];
  }
  return out;
}

function romanizeKoreanSpellingDisplay(text: string, style: KoreanOutputStyle): string {
  // Learner block mode: one Latin chunk per written Hangul block, dash-joined
  // within a word. Blocks are romanized in isolation so letters stay faithful
  // to the written block (국 → guk even before a vowel).
  let out = "";
  let pendingDash = false;
  for (const char of Array.from(text)) {
    const syl = decomposeHangul(char);
    if (syl) {
      if (pendingDash) out += "-";
      out += HANGUL_INITIAL[syl[0]] + koreanVowel(syl, style) + HANGUL_FINAL[syl[2]];
      pendingDash = true;
    } else {
      out += char;
      pendingDash = false;
    }
  }
  return out;
}

function applyKoreanUiPronunciation(run: HangulSyllable[]): void {
  for (let i = 0; i < run.length; i += 1) {
    const syl = run[i];
    if (syl[1] !== NUC_UI) continue;
    if (syl[0] !== ON_NULL || i > 0) syl[1] = NUC_I;
  }
}

function isKoreanPossessiveUiWord(word: string): boolean {
  return word.length > 1 && word.endsWith("의") && !KOREAN_LEXICAL_UI_WORDS.has(word);
}

function rewriteKoreanUiForG2p(word: string): string {
  if (isKoreanPossessiveUiWord(word)) return `${word.slice(0, -1)}에`;
  return word.replace(/(?<=.)의/g, "이");
}

function romanizeKoreanPronouncedRun(run: HangulSyllable[], style: KoreanOutputStyle): string {
  applyKoreanUiPronunciation(run);
  let out = "";
  let prevCoda = CODA_NONE;
  for (const syl of run) {
    const onset = syl[0] === ON_R && prevCoda === CODA_L ? "l" : HANGUL_INITIAL[syl[0]];
    out += onset + koreanVowel(syl, style) + (CODA_ROMAN[syl[2]] ?? "");
    prevCoda = syl[2];
  }
  return out;
}

function romanizeKoreanPronouncedSyllableParts(run: HangulSyllable[], style: KoreanOutputStyle): KoreanRomanizedSyllablePart[] {
  const adjusted = run.map((syl) => [...syl] as HangulSyllable);
  applyKoreanUiPronunciation(adjusted);

  const parts: KoreanRomanizedSyllablePart[] = [];
  let prevCoda = CODA_NONE;
  for (const syl of adjusted) {
    parts.push({
      onset: syl[0] === ON_R && prevCoda === CODA_L ? "l" : HANGUL_INITIAL[syl[0]],
      vowel: koreanVowel(syl, style),
      coda: CODA_ROMAN[syl[2]] ?? "",
    });
    prevCoda = syl[2];
  }
  return parts;
}

function romanizePronouncedHangul(text: string, style: KoreanOutputStyle): string {
  let out = "";
  let run: HangulSyllable[] = [];
  const flush = () => {
    if (run.length === 0) return;
    out += romanizeKoreanPronouncedRun(run, style);
    run = [];
  };
  for (const char of text) {
    const syl = decomposeHangul(char);
    if (syl) {
      run.push(syl);
    } else {
      flush();
      out += char;
    }
  }
  flush();
  return out;
}

function romanizeKoreanPronouncedPieces(pronounced: string, style: KoreanOutputStyle): string[] {
  const pieces: string[] = [];
  let run: HangulSyllable[] = [];
  const flush = () => {
    if (run.length === 0) return;
    for (const part of romanizeKoreanPronouncedSyllableParts(run, style)) {
      pieces.push(part.onset + part.vowel + part.coda);
    }
    run = [];
  };

  for (const char of pronounced) {
    const syl = decomposeHangul(char);
    if (syl) {
      run.push(syl);
    } else {
      flush();
      pieces.push(char);
    }
  }
  flush();
  return pieces;
}

export function romanizeKoreanSyllablePieces(text: string, style: KoreanOutputStyle = "rr"): string[] {
  return romanizeKoreanPronouncedPieces(pronounceKoreanHangul(normalizeKoreanDisplaySource(text)), style);
}

function romanizeKoreanSpellingPieces(text: string, style: KoreanOutputStyle = "rr"): string[] {
  const pieces: string[] = [];
  const chars = Array.from(text);
  for (let index = 0; index < chars.length; index += 1) {
    const syl = decomposeHangul(chars[index]);
    if (!syl) {
      pieces.push(chars[index]);
      continue;
    }
    const next = chars[index + 1] ? decomposeHangul(chars[index + 1]) : null;
    pieces.push(HANGUL_INITIAL[syl[0]] + koreanVowel(syl, style) + koreanSpellingCoda(syl, next, style));
  }
  return pieces;
}

function romanizeKoreanCommonRrPieces(text: string): string[] {
  const pieces: string[] = [];
  const chars = Array.from(text);
  for (let index = 0; index < chars.length; index += 1) {
    const syl = decomposeHangul(chars[index]);
    if (!syl) {
      pieces.push(chars[index]);
      continue;
    }

    const next = chars[index + 1] ? decomposeHangul(chars[index + 1]) : null;
    if (syl[2] !== CODA_NONE && next?.[0] === ON_NULL) {
      pieces.push(HANGUL_INITIAL[syl[0]] + HANGUL_VOWEL[syl[1]]);
      pieces.push((CODA_LIAISON_RR[syl[2]] ?? HANGUL_FINAL[syl[2]]) + HANGUL_VOWEL[next[1]] + HANGUL_FINAL[next[2]]);
      index += 1;
      continue;
    }

    pieces.push(HANGUL_INITIAL[syl[0]] + HANGUL_VOWEL[syl[1]] + HANGUL_FINAL[syl[2]]);
  }
  return pieces;
}

export function romanizeKoreanDisplayPieces(text: string, mode: KoreanDisplayMode = "rrStandard"): string[] {
  const source = normalizeKoreanDisplaySource(text);
  if (mode === "wordTranslit") return romanizeKoreanSpellingPieces(source, "rr");
  if (mode === "rrStandard") return romanizeKoreanCommonRrPieces(source);
  return romanizeKoreanPronouncedPieces(pronounceKoreanHangul(source), koreanOutputStyleForDisplayMode(mode));
}

function convertKoreanWordToPronouncedHangul(word: string): string {
  return KOREAN_POST_G2P_EXCEPTIONS[word] ?? getKoreanG2p().convert(rewriteKoreanUiForG2p(word));
}

function koreanDependentNounAfterL(word: string): string | undefined {
  if (KOREAN_DEPENDENT_NOUNS_AFTER_L.has(word)) return word;
  return undefined;
}

function shouldJoinKoreanG2pBigram(word: string, nextWord: string | undefined): boolean {
  if (!nextWord || !koreanDependentNounAfterL(nextWord)) return false;
  return endsWithHangulCoda(word, CODA_L);
}

function convertKoreanHangulRunToPronouncedHangul(run: string): string {
  const words = run.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return run;

  const converted: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const nextWord = words[index + 1];
    const phraseException = nextWord ? KOREAN_POST_G2P_PHRASE_EXCEPTIONS[`${word} ${nextWord}`] : undefined;
    if (phraseException) {
      converted.push(...phraseException);
      index += 1;
      continue;
    }
    if (shouldJoinKoreanG2pBigram(word, nextWord)) {
      const pair = getKoreanG2p().convert(`${word} ${nextWord}`).split(/\s+/);
      converted.push(pair[0] ?? convertKoreanWordToPronouncedHangul(word));
      converted.push(pair[1] ?? convertKoreanWordToPronouncedHangul(nextWord));
      index += 1;
      continue;
    }
    converted.push(convertKoreanWordToPronouncedHangul(word));
  }

  const leading = run.match(/^\s*/)?.[0] ?? "";
  const trailing = run.match(/\s*$/)?.[0] ?? "";
  return `${leading}${converted.join(" ")}${trailing}`;
}

export function pronounceKoreanHangul(text: string): string {
  let out = "";
  let run = "";
  const flush = () => {
    if (!run) return;
    out += convertKoreanHangulRunToPronouncedHangul(run);
    run = "";
  };

  for (const char of text) {
    if (isHangulSyllable(char) || (run && /\s/.test(char))) {
      run += char;
    } else {
      flush();
      out += char;
    }
  }
  flush();
  return out;
}

function romanizeKoreanPronunciation(text: string, style: KoreanOutputStyle): string {
  return romanizePronouncedHangul(pronounceKoreanHangul(text), style);
}

function endsWithHangulCoda(text: string, coda: number): boolean {
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const syl = decomposeHangul(text[index]);
    if (syl) return syl[2] === coda;
    if (!/\s/.test(text[index])) break;
  }
  return false;
}

function romanizedPartLength(part: KoreanRomanizedSyllablePart): number {
  return part.onset.length + part.vowel.length + part.coda.length;
}

function romanizedOffsetBeforeSyllable(parts: KoreanRomanizedSyllablePart[], syllableIndex: number): number {
  let offset = 0;
  for (let index = 0; index < syllableIndex; index += 1) offset += romanizedPartLength(parts[index]);
  return offset;
}

const ROMAJI_VOWEL_CHARS = new Set(["a", "e", "i", "o", "u", "ê", "ô", "ư"]);
const ROMAJI_GLIDE_CHARS = new Set(["w", "y"]);
// RR two-letter vowel digraphs a reader could mis-tokenize across a syllable
// boundary (해운대 "haeundae" → hae-undae). VN vowels are single glyphs, so the
// rule never applies there.
const RR_VOWEL_DIGRAPHS = new Set(["ae", "eo", "eu", "oe", "ui"]);

/**
 * Syllable-junction hyphen policy (docs decision 2026-07-12): hyphenate only
 * where the bare joined romanization is genuinely misreadable —
 * 1. n|g / ng|vowel-glide junctions, where the two parses sound different
 *    (han-guk vs hang-uk; gang-won vs gan-gwon);
 * 2. RR vowel-digraph junctions (cheo-eum, hae-undae);
 * 3. triple same-letter collisions (jalmot-ttwaet-ttan); doubles stay joined
 *    (silla).
 * Sound-identical ambiguities (miryeoni: n liaises either way) do NOT
 * hyphenate — pronunciation is unaffected, per NIKL's readability argument.
 */
function koreanJunctionNeedsHyphen(left: string, right: string, style: KoreanOutputStyle): boolean {
  if (!left || !right) return false;
  const lastChar = left[left.length - 1];
  const firstChar = right[0];

  let trailing = 0;
  for (let i = left.length - 1; i >= 0 && left[i] === lastChar; i -= 1) trailing += 1;
  let leading = 0;
  for (let i = 0; i < right.length && right[i] === lastChar; i += 1) leading += 1;
  if (leading > 0 && trailing + leading >= 3) return true;

  if (lastChar === "n" && firstChar === "g") return true;
  if (left.endsWith("ng") && (ROMAJI_VOWEL_CHARS.has(firstChar) || ROMAJI_GLIDE_CHARS.has(firstChar))) return true;

  if (style === "rr" && RR_VOWEL_DIGRAPHS.has(lastChar + firstChar)) return true;
  return false;
}

function romanizeKoreanPronunciationWordWithSeparators(word: string, style: KoreanOutputStyle): string {
  const pronounced = convertKoreanWordToPronouncedHangul(word);
  const writtenChars = Array.from(word);
  const pronouncedChars = Array.from(pronounced);
  if (writtenChars.length !== pronouncedChars.length) return romanizePronouncedHangul(pronounced, style);

  const pronouncedSyllables = pronouncedChars.map(decomposeHangul);
  if (writtenChars.map(decomposeHangul).some((syl) => !syl) || pronouncedSyllables.some((syl) => !syl)) {
    return romanizePronouncedHangul(pronounced, style);
  }

  const pronouncedRun = pronouncedSyllables as HangulSyllable[];
  const parts = romanizeKoreanPronouncedSyllableParts(pronouncedRun, style);
  const hyphenOffsets = new Set<number>();

  for (let index = 1; index < parts.length; index += 1) {
    const left = parts[index - 1].onset + parts[index - 1].vowel + parts[index - 1].coda;
    const right = parts[index].onset + parts[index].vowel + parts[index].coda;
    if (koreanJunctionNeedsHyphen(left, right, style)) {
      hyphenOffsets.add(romanizedOffsetBeforeSyllable(parts, index));
    }
  }

  let out = "";
  let offset = 0;
  for (const part of parts) {
    for (const piece of [part.onset, part.vowel, part.coda]) {
      if (hyphenOffsets.has(offset) && !out.endsWith("-")) out += "-";
      out += piece;
      offset += piece.length;
    }
  }
  if (hyphenOffsets.has(offset) && !out.endsWith("-")) out += "-";
  return out;
}

function romanizeKoreanPronunciationTokenWithSeparators(token: string, style: KoreanOutputStyle): string {
  let out = "";
  let run = "";
  const flush = () => {
    if (!run) return;
    out += romanizeKoreanPronunciationWordWithSeparators(run, style);
    run = "";
  };

  for (const char of token) {
    if (isHangulSyllable(char)) {
      run += char;
    } else {
      flush();
      out += char;
    }
  }
  flush();
  return out;
}

function pronouncedKoreanBigramSecondWord(word: string, nextWord: string): string {
  return getKoreanG2p().convert(`${rewriteKoreanUiForG2p(word)} ${rewriteKoreanUiForG2p(nextWord)}`).split(/\s+/)[1] ?? convertKoreanWordToPronouncedHangul(nextWord);
}

function romanizeKoreanPronunciationDisplay(text: string, style: KoreanOutputStyle): string {
  const tokens = text.split(/(\s+)/);
  const out: string[] = [];
  let previousSource = "";

  for (const token of tokens) {
    if (!token) continue;
    if (/^\s+$/.test(token)) {
      if (out.length > 0 && !out[out.length - 1].endsWith("-")) out.push(token);
      continue;
    }

    let rendered = romanizeKoreanPronunciationTokenWithSeparators(token, style);
    if (shouldJoinKoreanG2pBigram(previousSource, token)) {
      const pronouncedSecondWord = pronouncedKoreanBigramSecondWord(previousSource, token);
      rendered = romanizePronouncedHangul(pronouncedSecondWord, style);
      if (Array.from(token).length === 1) {
        while (out.length > 0 && /^\s+$/.test(out[out.length - 1])) out.pop();
        rendered = `-${rendered}`;
      }
    }
    out.push(rendered);
    previousSource = token;
  }

  return out.join("").replace(/\s+/g, " ").trim();
}

export function romanizeKorean(text: string, mode: KoreanMode = "spelling", style: KoreanOutputStyle = "rr", separators = false): string {
  const readable = normalizeKoreanDisplaySource(text);
  if (mode === "pronunciation" && separators) return romanizeKoreanPronunciationDisplay(readable, style);
  if (mode === "spelling" && separators) return romanizeKoreanSpellingDisplay(readable, style);
  return mode === "pronunciation" ? romanizeKoreanPronunciation(readable, style) : romanizeKoreanSpelling(readable, style);
}

export function koreanOutputStyleForDisplayMode(mode: KoreanDisplayMode): KoreanOutputStyle {
  return mode === "vnPronunciation" ? "vn" : "rr";
}

export function romanizeKoreanForDisplay(text: string, mode: KoreanDisplayMode = "rrStandard"): KoreanRomanizeResult {
  const source = normalizeKoreanDisplaySource(text);
  if (mode === "wordTranslit") {
    return { source, display: romanizeKoreanSpellingDisplay(source, "rr") };
  }
  if (mode === "rrStandard") {
    return { source, display: romanizeKoreanCommonRr(source) };
  }

  const style = koreanOutputStyleForDisplayMode(mode);
  const pronouncedHangul = pronounceKoreanHangul(source);
  return {
    source,
    display: romanizeKoreanPronunciationDisplay(source, style),
    pronouncedHangul,
    syllablePieces: romanizeKoreanPronouncedPieces(pronouncedHangul, style),
  };
}

export function romanizeKoreanSyllableLineForDisplay(
  syllables: KoreanSyllableLike[],
  mode: KoreanDisplayMode = "rrStandard"
): KoreanRomanizeResult {
  return romanizeKoreanForDisplay(buildKoreanLineTextFromSyllables(syllables), mode);
}

// ─── Japanese Romaji Fallback ─────────────────────────────────────────────────

/**
 * Build complete romaji from Kuromoji token context.
 * This is the robust fallback when kuroshiro fails to convert certain kanji.
 * 
 * @param text - Japanese text to romanize
 * @returns Spaced romaji string, or null if tokenization fails
 */
export async function buildRomajiFromTokens(text: string): Promise<string | null> {
  return (await analyzeJapaneseLine(text))?.romaji || null;
}

/**
 * Try kuroshiro conversion first, fall back to token-based if kanji remain.
 * 
 * @param text - Japanese text to romanize
 * @param romajiConverter - Initialized Kuroshiro instance
 * @returns Spaced romaji string
 */
export async function romanizeJapaneseWithFallback(
  text: string,
  romajiConverter: Kuroshiro
): Promise<string> {
  let result = await romajiConverter.convert(text, {
    to: "romaji",
    mode: "spaced",
  });

  // Fallback: rebuild when Kuroshiro leaves kanji or romanizes Latin inside Japanese lines.
  if (hasUnromanizedKanji(result) || (JapaneseSourceTextTest.test(text) && LatinTextTest.test(text))) {
    const rebuilt = await buildRomajiFromTokens(text);
    if (rebuilt) {
      result = rebuilt;
    }
  }

  return result;
}
