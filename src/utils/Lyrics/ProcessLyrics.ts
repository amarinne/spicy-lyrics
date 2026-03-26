/**
 * ProcessLyrics - Lyrics Processing Pipeline
 * 
 * Main entry point for processing lyrics with romanization and translation.
 * This file orchestrates the upstream romanization packages with fork-specific
 * enhancements imported from the Fork/ modules.
 */

import { franc } from "franc-all";
import Kuroshiro from "kuroshiro";
import langs from "langs";
import { RetrievePackage } from "../ImportPackage.ts";
import * as KuromojiAnalyzer from "./KuromojiAnalyzer.ts";
import { PageContainer } from "../../components/Pages/PageView.ts";
import { chineseTranslitMode } from "./lyrics.ts";

// Fork customizations
import {
  ChineseTextTest,
  JapaneseTextTest,
  KoreanTextTest,
  CyrillicTextTest,
  GreekTextTest,
  hasUnromanizedKanji,
  isCyrillicLanguage,
  JUKUJIKUN,
} from "./Fork/index.ts";
import { romanizeCantonese, romanizeCyrillic, buildRomajiFromTokens } from "./Fork/Romanization.ts";
import { translateLyrics } from "./Fork/Translation.ts";
import { mapRomajiToJapaneseSyllables } from "./Fork/SyllableSync.ts";

// Re-export clearTranslationCache for LyricsCacheTools.ts
export { clearTranslationCache } from "./Fork/Translation.ts";

// ─── Kuroshiro Setup ──────────────────────────────────────────────────────────

const RomajiConverter = new Kuroshiro();
const RomajiPromise = RomajiConverter.init(KuromojiAnalyzer);

// ─── Package Loading ──────────────────────────────────────────────────────────

RetrievePackage("pinyin", "4.0.0", "mjs").catch(() => {});
RetrievePackage("aromanize", "1.0.0", "js").catch(() => {});
RetrievePackage("GreekRomanization", "1.0.0", "js").catch(() => {});

type RomanizationBranch = "Japanese" | "Chinese" | "Korean" | "Cyrillic" | "Greek";

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

const preloadRomanizationPackages = async (
  branch: RomanizationBranch
): Promise<RomanizationPackages> => {
  const packages: RomanizationPackages = {};
  if (branch === "Japanese") {
    await RomajiPromise;
  } else if (branch === "Chinese") {
    packages.pinyin = await RetrievePackage("pinyin", "4.0.0", "mjs");
    while (!packages.pinyin) {
      await new Promise((r) => setTimeout(r, 50));
    }
  } else if (branch === "Korean") {
    packages.aromanize = await RetrievePackage("aromanize", "1.0.0", "js");
    while (!packages.aromanize) {
      await new Promise((r) => setTimeout(r, 50));
    }
  } else if (branch === "Greek") {
    packages.greekRomanization = await RetrievePackage("GreekRomanization", "1.0.0", "js");
    while (!packages.greekRomanization) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  return packages;
};

// ─── Romanization Types ───────────────────────────────────────────────────────

export type RomanizeOptions = {
  skipTextTests?: boolean;
  packages?: RomanizationPackages;
};

// ─── Language-Specific Romanizers ─────────────────────────────────────────────

const RomanizeKorean = async (
  lyricMetadata: any,
  primaryLanguage: string,
  preloadedAromanize: any | undefined,
  skipTextTests: boolean
) => {
  const aromanize =
    preloadedAromanize ?? (await RetrievePackage("aromanize", "1.0.0", "js"));
  while (!aromanize) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (primaryLanguage === "kor" || (!skipTextTests && KoreanTextTest.test(lyricMetadata.Text))) {
    lyricMetadata.RomanizedText = aromanize.default(
      lyricMetadata.Text,
      "RevisedRomanizationTransliteration"
    );
  }
};

const RomanizeChinese = async (
  lyricMetadata: any,
  primaryLanguage: string,
  preloadedPinyin: any | undefined,
  skipTextTests: boolean
) => {
  const pinyin = preloadedPinyin ?? (await RetrievePackage("pinyin", "4.0.0", "mjs"));
  while (!pinyin) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (primaryLanguage === "cmn" || primaryLanguage === "yue" || (!skipTextTests && ChineseTextTest.test(lyricMetadata.Text))) {
    const result = pinyin.pinyin(lyricMetadata.Text, {
      segment: false,
      group: false,
    });

    // Result format: array of [reading] arrays when group=false
    const readings: string[] = [];
    for (const item of result) {
      const reading = Array.isArray(item) ? item[0] : item;
      if (typeof reading === "string" && reading.trim().length > 0) {
        readings.push(reading);
      }
    }
    lyricMetadata.RomanizedText = readings.join(" ");
  }
};

const RomanizeCantoneseWrapper = async (
  lyricMetadata: any,
  primaryLanguage: string,
  skipTextTests: boolean
) => {
  const result = await romanizeCantonese(lyricMetadata.Text, primaryLanguage, skipTextTests);
  if (result) {
    lyricMetadata.RomanizedText = result;
  }
};

const RomanizeJapanese = async (
  lyricMetadata: any,
  primaryLanguage: string,
  skipTextTests: boolean
) => {
  if (primaryLanguage === "jpn" || (!skipTextTests && JapaneseTextTest.test(lyricMetadata.Text))) {
    await RomajiPromise;

    let result = await RomajiConverter.convert(lyricMetadata.Text, {
      to: "romaji",
      mode: "spaced",
    });

    // Fallback: if kuroshiro still left kanji un-romanized, rebuild from kuromoji tokens
    if (hasUnromanizedKanji(result)) {
      const rebuilt = await buildRomajiFromTokens(lyricMetadata.Text);
      if (rebuilt) {
        result = rebuilt;
      }
    }

    lyricMetadata.RomanizedText = result;
  }
};

const RomanizeCyrillicWrapper = async (
  lyricMetadata: any,
  primaryLanguage: string,
  iso2Lang: string,
  skipTextTests: boolean
) => {
  if (
    isCyrillicLanguage(primaryLanguage, iso2Lang) ||
    (!skipTextTests && CyrillicTextTest.test(lyricMetadata.Text))
  ) {
    lyricMetadata.RomanizedText = romanizeCyrillic(lyricMetadata.Text);
  }
};

const RomanizeGreek = async (
  lyricMetadata: any,
  primaryLanguage: string,
  preloadedGreekRomanization: any | undefined,
  skipTextTests: boolean
) => {
  const greekRomanization =
    preloadedGreekRomanization ?? (await RetrievePackage("GreekRomanization", "1.0.0", "js"));
  while (!greekRomanization) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (primaryLanguage === "ell" || (!skipTextTests && GreekTextTest.test(lyricMetadata.Text))) {
    const result = greekRomanization.default(lyricMetadata.Text);
    if (result != null) {
      lyricMetadata.RomanizedText = result;
    }
  }
};

// ─── Main Romanization Orchestrator ───────────────────────────────────────────

const Romanize = async (
  lyricMetadata: any,
  rootInformation: any,
  options?: RomanizeOptions
): Promise<string | undefined> => {
  const primaryLanguage = rootInformation.Language;
  const iso2Language = rootInformation.LanguageISO2;
  const skipTextTests = options?.skipTextTests === true;
  const packages = options?.packages;

  try {
    // NFKC normalize: converts Kangxi Radicals, CJK Compatibility
    // Ideographs, and other Unicode variants to standard CJK codepoints.
    if (lyricMetadata.Text) {
      lyricMetadata.Text = lyricMetadata.Text.normalize("NFKC");
    }

    const textSample = (lyricMetadata.Text || "").substring(0, 50);
    const hasJpnChars = JapaneseTextTest.test(lyricMetadata.Text || "");
    const hasChnChars = ChineseTextTest.test(lyricMetadata.Text || "");
    console.log("[SpicyLyrics:Debug] Romanize called. lang:", primaryLanguage, "hasJpn:", hasJpnChars, "hasChn:", hasChnChars, "text:", textSample);

    if (primaryLanguage === "jpn" || (!skipTextTests && hasJpnChars)) {
      await RomanizeJapanese(lyricMetadata, primaryLanguage, skipTextTests);
      rootInformation.IncludesRomanization = true;
      console.log("[SpicyLyrics:Debug] Romanized as Japanese:", (lyricMetadata.RomanizedText || "").substring(0, 50));
      return "Japanese";
    } else if (primaryLanguage === "cmn" || primaryLanguage === "yue" || (!skipTextTests && hasChnChars)) {
      if (chineseTranslitMode === "jyutping") {
        await RomanizeCantoneseWrapper(lyricMetadata, primaryLanguage, skipTextTests);
      } else {
        await RomanizeChinese(lyricMetadata, primaryLanguage, packages?.pinyin, skipTextTests);
      }
      rootInformation.IncludesRomanization = true;
      rootInformation.DetectedChinese = true;
      return "Chinese";
    } else if (primaryLanguage === "kor" || (!skipTextTests && KoreanTextTest.test(lyricMetadata.Text))) {
      await RomanizeKorean(lyricMetadata, primaryLanguage, packages?.aromanize, skipTextTests);
      rootInformation.IncludesRomanization = true;
      return "Korean";
    } else if (
      isCyrillicLanguage(primaryLanguage, iso2Language) ||
      (!skipTextTests && CyrillicTextTest.test(lyricMetadata.Text))
    ) {
      await RomanizeCyrillicWrapper(lyricMetadata, primaryLanguage, iso2Language, skipTextTests);
      rootInformation.IncludesRomanization = true;
      return "Cyrillic";
    } else if (primaryLanguage === "ell" || (!skipTextTests && GreekTextTest.test(lyricMetadata.Text))) {
      await RomanizeGreek(lyricMetadata, primaryLanguage, packages?.greekRomanization, skipTextTests);
      rootInformation.IncludesRomanization = true;
      return "Greek";
    } else {
      return undefined;
    }
  } catch (err) {
    console.error("[SpicyLyrics] Romanization error:", err);
    return undefined;
  }
};

// ─── Syllable Sync Wrapper ────────────────────────────────────────────────────

const mapRomajiToSyllables = async (
  lineText: string,
  fullSpacedRomaji: string,
  syllables: any[]
): Promise<void> => {
  await mapRomajiToJapaneseSyllables(lineText, fullSpacedRomaji, syllables, RomajiPromise);
};

// ─── Main Processing Entry Point ──────────────────────────────────────────────

export const ProcessLyrics = async (lyrics: any) => {
  console.log("[SpicyLyrics:Debug] ProcessLyrics called. Type:", lyrics.Type, "Content length:", lyrics.Content?.length || lyrics.Lines?.length, "alt_api:", lyrics.alternative_api || false, "Language(pre):", lyrics.Language);
  lyrics.IncludesRomanization = false;
  const romanizationPromises: Promise<string | undefined>[] = [];
  let romanizeOptions: RomanizeOptions | undefined;

  if (lyrics.Type === "Static") {
    {
      let textToProcess = lyrics.Lines[0].Text;
      for (let index = 1; index < lyrics.Lines.length; index += 1) {
        textToProcess += `\n${lyrics.Lines[index].Text}`;
      }

      const language = franc(textToProcess);
      const languageISO2 = langs.where("3", language)?.["1"];
      console.log("[SpicyLyrics:Debug] Static franc result:", language, "iso2:", languageISO2, "text sample:", textToProcess.substring(0, 100));

      lyrics.Language = language;
      lyrics.LanguageISO2 = languageISO2;

      const branch = romanizationBranchFromFranc(language, languageISO2);
      if (branch !== undefined) {
        romanizeOptions = {
          skipTextTests: true,
          packages: await preloadRomanizationPackages(branch),
        };
      }
    }

    for (const lyricMetadata of lyrics.Lines) {
      romanizationPromises.push(Romanize(lyricMetadata, lyrics, romanizeOptions));
    }
  } else if (lyrics.Type === "Line") {
    {
      const lines = [];
      for (const vocalGroup of lyrics.Content) {
        const text = vocalGroup.Text;
        if (text) {
          lines.push(text);
        }
      }
      const textToProcess = lines.join("\n");

      const language = franc(textToProcess);
      const languageISO2 = langs.where("3", language)?.["1"];
      console.log("[SpicyLyrics:Debug] Line franc result:", language, "iso2:", languageISO2, "text sample:", textToProcess.substring(0, 100));

      lyrics.Language = language;
      lyrics.LanguageISO2 = languageISO2;

      const branch = romanizationBranchFromFranc(language, languageISO2);
      if (branch !== undefined) {
        romanizeOptions = {
          skipTextTests: true,
          packages: await preloadRomanizationPackages(branch),
        };
      }
    }

    for (const vocalGroup of lyrics.Content) {
      if (vocalGroup.Text) {
        romanizationPromises.push(Romanize(vocalGroup, lyrics, romanizeOptions));
      }
    }
  } else if (lyrics.Type === "Syllable") {
    {
      const lines = [];
      for (const vocalGroup of lyrics.Content) {
        if (vocalGroup.Type === "Vocal") {
          let text = vocalGroup.Lead.Syllables[0].Text;
          for (let index = 1; index < vocalGroup.Lead.Syllables.length; index += 1) {
            const syllable = vocalGroup.Lead.Syllables[index];
            text += `${syllable.IsPartOfWord ? "" : " "}${syllable.Text}`;
          }
          lines.push(text);
        }
      }
      const textToProcess = lines.join("\n");

      const language = franc(textToProcess);
      const languageISO2 = langs.where("3", language)?.["1"];
      console.log("[SpicyLyrics:Debug] Syllable franc result:", language, "iso2:", languageISO2, "text sample:", textToProcess.substring(0, 100));

      lyrics.Language = language;
      lyrics.LanguageISO2 = languageISO2;

      const branch = romanizationBranchFromFranc(language, languageISO2);
      if (branch !== undefined) {
        romanizeOptions = {
          skipTextTests: true,
          packages: await preloadRomanizationPackages(branch),
        };
      }
    }

    for (const vocalGroup of lyrics.Content) {
      if (vocalGroup.Type === "Vocal") {
        // Clear any previous Lead-level romanization to force re-processing
        delete vocalGroup.Lead.RomanizedText;
        for (const syllable of vocalGroup.Lead.Syllables) {
          delete syllable.RomanizedText;
        }
        if (vocalGroup.Background) {
          for (const bg of vocalGroup.Background) {
            delete bg.RomanizedText;
            for (const syllable of bg.Syllables) {
              delete syllable.RomanizedText;
            }
          }
        }

        const primaryLanguage = lyrics.Language;
        const isJapanese = primaryLanguage === "jpn" || 
          vocalGroup.Lead.Syllables.some((s: any) => JapaneseTextTest.test(s.Text));

        // Build full line text from syllables
        let lineText = "";
        if (isJapanese) {
          for (const syllable of vocalGroup.Lead.Syllables) {
            lineText += syllable.Text;
          }
        } else {
          lineText = vocalGroup.Lead.Syllables[0].Text;
          for (let i = 1; i < vocalGroup.Lead.Syllables.length; i++) {
            const syllable = vocalGroup.Lead.Syllables[i];
            lineText += (syllable.IsPartOfWord ? "" : " ") + syllable.Text;
          }
        }

        // Romanize the full line (context-aware, best quality)
        const lineMetadata = { Text: lineText, RomanizedText: undefined as string | undefined };
        romanizationPromises.push(
          Romanize(lineMetadata, lyrics).then(async () => {
            vocalGroup.Lead.RomanizedText = lineMetadata.RomanizedText;

            // Map full-line romaji back to individual syllables
            if (lineMetadata.RomanizedText) {
              if (isJapanese) {
                await mapRomajiToSyllables(
                  lineText,
                  lineMetadata.RomanizedText,
                  vocalGroup.Lead.Syllables,
                );
              } else {
                // Non-Japanese: per-syllable romanization
                const isChinese = primaryLanguage === "cmn" || primaryLanguage === "yue" ||
                  vocalGroup.Lead.Syllables.some((s: any) => ChineseTextTest.test(s.Text));
                for (let si = 0; si < vocalGroup.Lead.Syllables.length; si++) {
                  const syllable = vocalGroup.Lead.Syllables[si];
                  const syllMeta = { Text: syllable.Text, RomanizedText: undefined as string | undefined };
                  await Romanize(syllMeta, lyrics);
                  syllable.RomanizedText = syllMeta.RomanizedText || undefined;
                  if (isChinese && si > 0 && syllable.RomanizedText) {
                    syllable.RomajiSpaceBefore = true;
                  }
                }
              }
            }

            return undefined;
          })
        );

        // Handle Background vocals
        if (vocalGroup.Background !== undefined) {
          for (const bg of vocalGroup.Background) {
            let bgText = "";
            if (isJapanese) {
              for (const syllable of bg.Syllables) {
                bgText += syllable.Text;
              }
            } else {
              bgText = bg.Syllables[0]?.Text || "";
              for (let i = 1; i < bg.Syllables.length; i++) {
                const syllable = bg.Syllables[i];
                bgText += (syllable.IsPartOfWord ? "" : " ") + syllable.Text;
              }
            }
            const bgMetadata = { Text: bgText, RomanizedText: undefined as string | undefined };
            romanizationPromises.push(
              Romanize(bgMetadata, lyrics).then(async () => {
                bg.RomanizedText = bgMetadata.RomanizedText;

                if (bgMetadata.RomanizedText) {
                  if (isJapanese) {
                    await mapRomajiToSyllables(
                      bgText,
                      bgMetadata.RomanizedText,
                      bg.Syllables,
                    );
                  } else {
                    const isBgChinese = primaryLanguage === "cmn" || primaryLanguage === "yue" ||
                      bg.Syllables.some((s: any) => ChineseTextTest.test(s.Text));
                    for (let si = 0; si < bg.Syllables.length; si++) {
                      const syllable = bg.Syllables[si];
                      const syllMeta = { Text: syllable.Text, RomanizedText: undefined as string | undefined };
                      await Romanize(syllMeta, lyrics);
                      syllable.RomanizedText = syllMeta.RomanizedText || undefined;
                      if (isBgChinese && si > 0 && syllable.RomanizedText) {
                        syllable.RomajiSpaceBefore = true;
                      }
                    }
                  }
                }

                return undefined;
              })
            );
          }
        }
      }
    }
  }

  await Promise.all(romanizationPromises);
  console.log("[SpicyLyrics] ProcessLyrics done. IncludesRomanization:", lyrics.IncludesRomanization, "DetectedChinese:", lyrics.DetectedChinese, "Language:", lyrics.Language);
  if (lyrics.IncludesRomanization === true) {
    PageContainer?.classList.add("Lyrics_RomanizationAvailable");
  } else {
    PageContainer?.classList.remove("Lyrics_RomanizationAvailable");
  }
  if (lyrics.DetectedChinese === true) {
    PageContainer?.classList.add("Lyrics_ChineseDetected");
  } else {
    PageContainer?.classList.remove("Lyrics_ChineseDetected");
  }

  // Translation pass (after romanization) — batched + cached
  await translateLyrics(lyrics);
  if (lyrics.IncludesTranslation === true) {
    PageContainer?.classList.add("Lyrics_TranslationAvailable");
  } else {
    PageContainer?.classList.remove("Lyrics_TranslationAvailable");
  }
};
