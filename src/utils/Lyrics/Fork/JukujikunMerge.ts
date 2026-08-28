/**
 * Shared Jukujikun + Token Merge Logic
 *
 * Shared compound kanji reading lookup and phonetic merge rules.
 */

export interface MergeableEntry {
  romaji: string;
  consumed: boolean;
  surface?: string;
  readingKana?: string;
}

const SMALL_TSU_ROMAJI = /(?:xtsu|ltsu|tsu)$/i;
const PLURAL_PRONOUN_BEFORE_KATA = /^(?:あなた|貴方|君|きみ|皆|みんな|僕|ぼく|私|わたし|我々)$/;

const doubledSokuon = (romaji: string): string => {
  if (!romaji) return romaji;
  const lower = romaji.toLowerCase();
  if (/^[aeioun]/.test(lower)) return romaji;
  return `${romaji[0]}${romaji}`;
};

function previousActive(entries: MergeableEntry[], index: number): number {
  for (let i = index; i >= 0; i -= 1) {
    if (!entries[i].consumed) return i;
  }
  return -1;
}

function setReading(entry: MergeableEntry, romaji: string, readingKana: string): void {
  entry.romaji = romaji;
  entry.readingKana = readingKana;
}

const pos1 = (token: any): string => token?.pos || token?.part_of_speech || token?.pos_detail_1 || "";

/**
 * Apply phonetic mutations that need neighboring tokens.
 * Example: いたっ + て => ita + tte, not itatsu te.
 */
export function applyContextualReadingOverrides(
  entries: MergeableEntry[],
  tokens: any[]
): void {
  for (let i = 0; i < tokens.length; i++) {
    if (entries[i].consumed) continue;

    const sf = entries[i].surface || tokens[i].surface_form || "";
    const prevIndex = previousActive(entries, i - 1);
    const prevSf = prevIndex >= 0 ? entries[prevIndex].surface || tokens[prevIndex]?.surface_form || "" : "";

    if (sf === "私" && pos1(tokens[i]) === "代名詞") {
      // Lyrics register: prefer わたし over formal わたくし. POS-guarded so
      // compounds such as 私立 stay dictionary-owned.
      setReading(entries[i], "watashi", "わたし");
      continue;
    }

    if (sf === "君" && pos1(tokens[i]) === "代名詞") {
      // Some dictionaries emit the honorific suffix reading くん for bare 君.
      // Independent pronoun use in lyrics should read きみ; suffix use stays kun.
      setReading(entries[i], "kimi", "きみ");
      continue;
    }

    if (sf === "1人" || (sf === "1" && entries[i + 1]?.surface === "人")) {
      // Numeric shorthand is outside the tokenizer's normal Japanese reading
      // lattice; keep this as a narrow counter normalization, not a compound
      // reading table.
      setReading(entries[i], "hitori", "ひとり");
      if (sf === "1") {
        entries[i].surface = "1人";
        (entries[i] as any).end = (entries[i + 1] as any).end;
        entries[i + 1].consumed = true;
      }
      continue;
    }

    if (sf === "2人" || (sf === "2" && entries[i + 1]?.surface === "人")) {
      setReading(entries[i], "futari", "ふたり");
      if (sf === "2") {
        entries[i].surface = "2人";
        (entries[i] as any).end = (entries[i + 1] as any).end;
        entries[i + 1].consumed = true;
      }
      continue;
    }

    if (sf === "方" && PLURAL_PRONOUN_BEFORE_KATA.test(prevSf)) {
      // Dictionary cannot infer plural-pronoun rendaku when tokenized as 貴方 + 方.
      const prevToken = prevIndex >= 0 ? tokens[prevIndex] : undefined;
      const currentPos = pos1(tokens[i]);
      if ((currentPos === "接尾辞" || currentPos === "名詞" || currentPos === "接尾")
          && pos1(prevToken) === "代名詞") {
        setReading(entries[i], "gata", "がた");
      }
    }
  }
}

export function applyPhoneticMerges(
  entries: MergeableEntry[],
  tokens: any[]
): void {
  for (let i = 1; i < tokens.length; i++) {
    if (entries[i].consumed) continue;

    let pi = i - 1;
    while (pi >= 0 && entries[pi].consumed) pi--;
    if (pi < 0) continue;

    const prevSf = tokens[pi].surface_form || "";
    const prevPron = tokens[pi].pronunciation || tokens[pi].reading || "";
    if (!(prevPron.endsWith("ッ") || prevPron.endsWith("っ") || prevSf.endsWith("っ") || prevSf.endsWith("ッ"))) {
      continue;
    }

    entries[pi].romaji = entries[pi].romaji.replace(SMALL_TSU_ROMAJI, "");
    entries[i].romaji = doubledSokuon(entries[i].romaji);
  }
}

/**
 * Pass 2: Determine which tokens should merge (no space before).
 * Returns a boolean array where true means "merge with previous token".
 */
export function computeNoSpaceBefore(
  entries: MergeableEntry[],
  tokens: any[]
): boolean[] {
  const noSpaceBefore: boolean[] = Array.from({ length: tokens.length }, () => false);
  for (let i = 1; i < tokens.length; i++) {
    if (entries[i].consumed) { noSpaceBefore[i] = true; continue; }

    let pi = i - 1;
    while (pi >= 0 && entries[pi].consumed) pi--;
    if (pi < 0) continue;

    const prevSf = tokens[pi].surface_form;
    const prevPron = tokens[pi].pronunciation || tokens[pi].reading || "";
    const currSf = tokens[i].surface_form;
    const currPron = tokens[i].pronunciation || tokens[i].reading || "";

    // っ/ッ at end of previous token → merge
    if (prevPron.endsWith("ッ") || prevPron.endsWith("っ") ||
        prevSf.endsWith("っ") || prevSf.endsWith("ッ")) {
      noSpaceBefore[i] = true;
    }

    // う extending previous o-row sound (long vowel)
    if ((currSf === "う" || currPron === "ウ") && prevPron) {
      const last = prevPron[prevPron.length - 1];
      if ("オコソトノホモヨロヲゴゾドボポョウクスツヌフムユルグズヅブプュ".includes(last)) {
        noSpaceBefore[i] = true;
      }
    }

    // い extending previous e-row sound (long vowel)
    if ((currSf === "い" || currPron === "イ") && prevPron) {
      const last = prevPron[prevPron.length - 1];
      if ("エケセテネヘメレゲゼデベペェ".includes(last)) {
        noSpaceBefore[i] = true;
      }
    }

    const prevPos1 = tokens[pi].pos || tokens[pi].part_of_speech || "";
    const prevPos2 = tokens[pi].pos_detail_1 || "";
    const currPos1 = tokens[i].pos || tokens[i].part_of_speech || "";
    const currPos2 = tokens[i].pos_detail_1 || "";
    const prevVerbLike = prevPos1 === "動詞" || prevPos1 === "助動詞" || prevPos2 === "接続助詞";
    if (prevVerbLike) {
      if (currPos1 === "動詞" && (currPos2 === "非自立" || currPos2 === "接尾")) noSpaceBefore[i] = true;
      if (currPos1 === "助詞" && currPos2 === "接続助詞") noSpaceBefore[i] = true;
      if (currPos1 === "助動詞" && !/^(?:でしょ|です|だろ)/.test(currSf)) noSpaceBefore[i] = true;
    }

    // Punctuation — no space before
    if (/^[。、？！…・「」『』（）().?!,\s]+$/.test(currSf)) {
      noSpaceBefore[i] = true;
    }
  }
  return noSpaceBefore;
}
