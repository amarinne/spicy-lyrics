import { franc } from "franc-all";
import Kuroshiro from "kuroshiro";
import langs from "langs";
import { RetrievePackage } from "../ImportPackage.ts";
import * as KuromojiAnalyzer from "./KuromojiAnalyzer.ts";
import { PageContainer } from "../../components/Pages/PageView.ts";
import Logger from "../Logger.ts";
import { chineseTranslitMode } from "./lyrics.ts";
import {
  ChineseTextTest,
  JapaneseTextTest,
  KoreanTextTest,
  CyrillicTextTest,
  GreekTextTest,
  CJKIdeographTest,
  isCyrillicLanguage,
} from "./Fork/index.ts";
import { buildRomajiFromTokens, romanizeCantonese, romanizeCyrillic } from "./Fork/Romanization.ts";
import { JUKUJIKUN } from "./Fork/JukujikuDict.ts";
import {
  annotateJapaneseTextTarget,
  applyJapaneseReadingToSyllables,
  clearLegacyFuriganaFields,
} from "./Reading/JapaneseReading.ts";
import { translateLyrics, clearTranslationCache } from "./Fork/Translation.ts";

export { clearTranslationCache };
export const LYRICS_PROCESSING_VERSION = 2;

// Constants
const RomajiConverter = new Kuroshiro();
const RomajiPromise = RomajiConverter.init(KuromojiAnalyzer);

const romanizationLogger = new Logger("Lyrics Romanization");

// Per-item (1-char) presence tests. Once a script is confirmed present in the
// whole song, a single matching character in an item is enough to romanize it.
const ItemJapaneseTest = /[぀-ヿ一-鿿]/;
const ItemChineseTest = /[一-鿿]/;
const ItemKoreanTest = KoreanTextTest;
const ItemCyrillicTest = /[Ѐ-ӿԀ-ԯⷠ-ⷿꙀ-ꚟ]/;
const ItemGreekTest = GreekTextTest;

// Any original (non-Latin) romanizable script — used in dev to flag residue.
const ResidualScriptTest = /[぀-ヿ一-鿿가-힯ᄀ-ᇿ㄰-㆏Ѐ-ԯͰ-Ͽἀ-῿]/;

// Load Packages
RetrievePackage("pinyin", "4.0.0", "mjs").catch(() => {});
RetrievePackage("aromanize", "1.0.0", "js").catch(() => {});
RetrievePackage("GreekRomanization", "1.0.0", "js").catch(() => {});

type RomanizationBranch = "Japanese" | "Chinese" | "Korean" | "Cyrillic" | "Greek";

const SCRIPT_PRIORITY: RomanizationBranch[] = [
  "Japanese",
  "Chinese",
  "Korean",
  "Cyrillic",
  "Greek",
];

type RomanizationPackages = {
  aromanize?: any;
  pinyin?: any;
  greekRomanization?: any;
};

const romanizationBranchFromFranc = (
  primaryLanguage: string,
  iso2Language: string | undefined
): RomanizationBranch | undefined => {
  if (primaryLanguage === "jpn") return "Japanese";
  if (primaryLanguage === "cmn" || primaryLanguage === "yue") return "Chinese";
  if (primaryLanguage === "kor") return "Korean";
  if (isCyrillicLanguage(primaryLanguage, iso2Language)) return "Cyrillic";
  if (primaryLanguage === "ell") return "Greek";
  return undefined;
};

const loadPackagesForScripts = async (
  scripts: RomanizationBranch[]
): Promise<RomanizationPackages> => {
  const packages: RomanizationPackages = {};
  for (const script of scripts) {
    if (script === "Japanese") {
      await RomajiPromise;
    } else if (script === "Chinese" && chineseTranslitMode !== "jyutping") {
      packages.pinyin = await RetrievePackage("pinyin", "4.0.0", "mjs");
    } else if (script === "Korean") {
      packages.aromanize = await RetrievePackage("aromanize", "1.0.0", "js");
    } else if (script === "Greek") {
      packages.greekRomanization = await RetrievePackage("GreekRomanization", "1.0.0", "js");
    }
  }
  return packages;
};

const romanizeJapaneseText = async (text: string): Promise<string> => {
  await RomajiPromise;
  const normalized = text.normalize("NFKC");
  let result = await RomajiConverter.convert(normalized, { to: "romaji", mode: "spaced" });
  if (CJKIdeographTest.test(result) || /[っッ]/.test(normalized) || Object.keys(JUKUJIKUN).some((term) => normalized.includes(term))) {
    const rebuilt = await buildRomajiFromTokens(normalized);
    if (rebuilt) result = rebuilt;
  }
  return result;
};

const romanizeChineseText = async (
  text: string,
  pinyin: any,
  primaryLanguage: string
): Promise<string> => {
  if (chineseTranslitMode === "jyutping") {
    return (await romanizeCantonese(text, primaryLanguage, true)) ?? text;
  }
  if (!pinyin) return text;
  const result = pinyin.pinyin(text, { segment: false, group: true });
  return result.join(" ");
};

const romanizeKoreanText = (text: string, aromanize: any): string => {
  if (!aromanize) return text;
  return aromanize.default(text, "RevisedRomanizationTransliteration");
};

const romanizeCyrillicText = (text: string): string => romanizeCyrillic(text);

const romanizeGreekText = (text: string, greekRomanization: any): string => {
  if (!greekRomanization) return text;
  const result = greekRomanization.default(text);
  return result != null ? result : text;
};

type RomanizeEntry = { target: any; line: any };

const gatherText = (
  lyrics: any
): { francText: string; scriptText: string; entries: RomanizeEntry[] } => {
  const entries: RomanizeEntry[] = [];
  const textLines: string[] = [];
  const bgTextLines: string[] = [];

  if (lyrics.Type === "Static") {
    for (const line of lyrics.Lines) {
      entries.push({ target: line, line });
      textLines.push(line.Text);
    }
  } else if (lyrics.Type === "Line") {
    for (const vocalGroup of lyrics.Content) {
      if (vocalGroup.Type === "Vocal" || vocalGroup.Text) {
        entries.push({ target: vocalGroup, line: vocalGroup });
        textLines.push(vocalGroup.Text);
      }
    }
  } else if (lyrics.Type === "Syllable") {
    for (const vocalGroup of lyrics.Content) {
      if (vocalGroup.Type !== undefined && vocalGroup.Type !== "Vocal") continue;

      const syllables = vocalGroup.Lead.Syllables;
      if (syllables.length > 0) {
        let text = syllables[0].Text;
        entries.push({ target: syllables[0], line: vocalGroup });
        for (let index = 1; index < syllables.length; index += 1) {
          const syllable = syllables[index];
          text += `${syllable.IsPartOfWord ? "" : " "}${syllable.Text}`;
          entries.push({ target: syllable, line: vocalGroup });
        }
        textLines.push(text);
      }

      if (vocalGroup.Background !== undefined) {
        for (const bg of vocalGroup.Background) {
          for (const syllable of bg.Syllables) {
            entries.push({ target: syllable, line: vocalGroup });
            bgTextLines.push(syllable.Text);
          }
        }
      }
    }
  }

  const francText = textLines.join("\n");
  const scriptText = bgTextLines.length > 0 ? `${francText}\n${bgTextLines.join("\n")}` : francText;
  return { francText, scriptText, entries };
};

const detectPresentScripts = (
  scriptText: string,
  language: string,
  iso2Language: string | undefined
): RomanizationBranch[] => {
  const present = new Set<RomanizationBranch>();

  if (JapaneseTextTest.test(scriptText)) {
    present.add("Japanese");
  } else if (ChineseTextTest.test(scriptText)) {
    present.add("Chinese");
  }
  if (KoreanTextTest.test(scriptText)) present.add("Korean");
  if (CyrillicTextTest.test(scriptText)) present.add("Cyrillic");
  if (GreekTextTest.test(scriptText)) present.add("Greek");

  const hint = romanizationBranchFromFranc(language, iso2Language);
  if (hint && !present.has(hint)) {
    if (hint === "Japanese" || hint === "Chinese") {
      if (!present.has("Japanese") && !present.has("Chinese")) present.add(hint);
    } else {
      present.add(hint);
    }
  }

  return SCRIPT_PRIORITY.filter((script) => present.has(script));
};

const hasTransliteration = (entry: any): boolean =>
  typeof entry.TransliteratedText === "string" && entry.TransliteratedText !== "";

const LatinWordTextTest = /[A-Za-zÀ-ÖØ-öø-ÿĀ-žƀ-ɏ]/;

const joinSyllables = (syllables: any[], compact = false): string => {
  return syllables.reduce((acc, syl, index) => {
    const text = syl.Text || "";
    if (index === 0) return text;

    if (!compact) return `${acc}${syl.IsPartOfWord ? "" : " "}${text}`;

    const prevText = syllables[index - 1]?.Text || "";
    const shouldPreserveWordSpace = !syl.IsPartOfWord && (LatinWordTextTest.test(prevText) || LatinWordTextTest.test(text));
    return `${acc}${shouldPreserveWordSpace ? " " : ""}${text}`;
  }, "");
};

const romanizeLineText = async (
  text: string,
  presentScripts: RomanizationBranch[],
  packages: RomanizationPackages,
  language: string
): Promise<string | undefined> => {
  const entry = { target: { Text: text }, line: {} };
  const changed = await romanizeEntry(entry, presentScripts, packages, language, false);
  return changed ? entry.target.TransliteratedText : undefined;
};

const postProcessSyllableRomanization = async (
  lyrics: any,
  presentScripts: RomanizationBranch[],
  packages: RomanizationPackages,
  language: string
) => {
  if (lyrics.Type !== "Syllable") return;

  const isJapaneseSong =
    language === "jpn" ||
    lyrics.Content?.some((group: any) =>
      group.Lead?.Syllables?.some((s: any) => JapaneseTextTest.test(s.Text || ""))
    );
  const isChineseSong =
    language === "cmn" ||
    language === "yue" ||
    lyrics.Content?.some((group: any) =>
      group.Lead?.Syllables?.some((s: any) => ChineseTextTest.test(s.Text || ""))
    );

  for (const vocalGroup of lyrics.Content || []) {
    if (vocalGroup.Type !== undefined && vocalGroup.Type !== "Vocal") continue;

    const processGroup = async (group: any) => {
      const syllables = group?.Syllables;
      if (!Array.isArray(syllables) || syllables.length === 0) return;

      const lineText = joinSyllables(syllables, isJapaneseSong);
      const fullRomaji = await romanizeLineText(lineText, presentScripts, packages, language);
      if (!fullRomaji) return;

      group.TransliteratedText = fullRomaji;
      group.RomanizedText = fullRomaji;

      if (isJapaneseSong) {
        for (const syllable of syllables) {
          delete syllable.RomanizedText;
          delete syllable.TransliteratedText;
          delete syllable.RomajiSpaceBefore;
          clearLegacyFuriganaFields(syllable);
          delete syllable.JapaneseReading;
        }
        group.JapaneseReading = await applyJapaneseReadingToSyllables(lineText, fullRomaji, syllables, RomajiPromise);
        for (const syllable of syllables) {
          if (syllable.RomanizedText) {
            syllable.TransliteratedText = syllable.RomanizedText;
          } else {
            delete syllable.TransliteratedText;
          }
        }
      } else {
        for (let index = 0; index < syllables.length; index += 1) {
          const syllable = syllables[index];
          if (syllable.TransliteratedText && !syllable.RomanizedText) {
            syllable.RomanizedText = syllable.TransliteratedText;
          }
          if (isChineseSong && index > 0 && syllable.RomanizedText) {
            syllable.RomajiSpaceBefore = true;
          }
        }
      }
    };

    await processGroup(vocalGroup.Lead);
    for (const bg of vocalGroup.Background || []) {
      await processGroup(bg);
    }
  }
};

const romanizeEntry = async (
  entry: RomanizeEntry,
  presentScripts: RomanizationBranch[],
  packages: RomanizationPackages,
  primaryLanguage: string,
  annotateJapanese: boolean = true
): Promise<boolean> => {
  const { target, line } = entry;

  if (target.Text) target.Text = target.Text.normalize("NFKC");

  if (hasTransliteration(target)) {
    if (annotateJapanese && ItemJapaneseTest.test(target.Text || "") && !target.JapaneseReading) {
      await annotateJapaneseTextTarget(target, target.RomanizedText || target.TransliteratedText, RomajiPromise);
    }
    return false;
  }

  let text: string = target.Text;
  let changed = false;

  for (const script of presentScripts) {
    if (script === "Japanese") {
      if (ItemJapaneseTest.test(text)) {
        text = await romanizeJapaneseText(text);
        if (annotateJapanese) await annotateJapaneseTextTarget(target, text, RomajiPromise);
        changed = true;
      }
    } else if (script === "Chinese") {
      if (ItemChineseTest.test(text)) {
        text = await romanizeChineseText(text, packages.pinyin, primaryLanguage);
        changed = true;
      }
    } else if (script === "Korean") {
      if (ItemKoreanTest.test(text)) {
        text = romanizeKoreanText(text, packages.aromanize);
        changed = true;
      }
    } else if (script === "Cyrillic") {
      if (ItemCyrillicTest.test(text)) {
        text = romanizeCyrillicText(text);
        changed = true;
      }
    } else if (script === "Greek") {
      if (ItemGreekTest.test(text)) {
        text = romanizeGreekText(text, packages.greekRomanization);
        changed = true;
      }
    }
  }

  if (changed) {
    target.TransliteratedText = text;
    target.RomanizedText = text;
    line.HasTransliterations = true;
    if (ResidualScriptTest.test(text)) {
      romanizationLogger.warn("Incomplete romanization (original-script characters remain)", {
        original: target.Text,
        romanized: text,
      });
    }
  }

  return changed;
};

export const ProcessLyrics = async (
  lyrics: any,
  options: { updatePageClasses?: boolean; awaitTranslation?: boolean } = {}
) => {
  lyrics.ProcessingVersion = LYRICS_PROCESSING_VERSION;
  const updatePageClasses = options.updatePageClasses !== false;
  const awaitTranslation = options.awaitTranslation !== false;
  const hadApiTransliterations = lyrics.HasTransliterations === true;
  const { francText, scriptText, entries } = gatherText(lyrics);

  const language = franc(francText);
  const languageISO2 = langs.where("3", language)?.["1"];
  lyrics.Language = language;
  lyrics.LanguageISO2 = languageISO2;

  const presentScripts = detectPresentScripts(scriptText, language, languageISO2);

  let appliedRomanization = false;
  let packages: RomanizationPackages = {};
  const needsRomanizationOrJapaneseReading = entries.some((entry) =>
    !hasTransliteration(entry.target) ||
    (presentScripts.includes("Japanese") && ItemJapaneseTest.test(entry.target.Text || "") && !entry.target.JapaneseReading)
  );
  if (presentScripts.length > 0 && needsRomanizationOrJapaneseReading) {
    packages = await loadPackagesForScripts(presentScripts);
    const results = await Promise.all(
      entries.map((entry) => romanizeEntry(entry, presentScripts, packages, language, lyrics.Type !== "Syllable"))
    );
    appliedRomanization = results.some(Boolean);
  }

  if (presentScripts.length > 0) {
    if (Object.keys(packages).length === 0) packages = await loadPackagesForScripts(presentScripts);
    await postProcessSyllableRomanization(lyrics, presentScripts, packages, language);
  }

  lyrics.IncludesRomanization = hadApiTransliterations || appliedRomanization;
  lyrics.HasTransliterations = hadApiTransliterations || appliedRomanization;

  if (updatePageClasses) {
    if (lyrics.HasTransliterations === true) {
      PageContainer?.classList.add("Lyrics_RomanizationAvailable");
    } else {
      PageContainer?.classList.remove("Lyrics_RomanizationAvailable");
    }

    const detectedChinese = presentScripts.includes("Chinese");
    lyrics.DetectedChinese = detectedChinese;
    if (detectedChinese) {
      PageContainer?.classList.add("Lyrics_ChineseDetected");
    } else {
      PageContainer?.classList.remove("Lyrics_ChineseDetected");
    }
  }

  if (awaitTranslation) {
    lyrics.DetectedChinese = presentScripts.includes("Chinese");

  await translateLyrics(lyrics);
    if (updatePageClasses) {
      if (lyrics.IncludesTranslation === true) {
        PageContainer?.classList.add("Lyrics_TranslationAvailable");
      } else {
        PageContainer?.classList.remove("Lyrics_TranslationAvailable");
      }
    }
  }
};
