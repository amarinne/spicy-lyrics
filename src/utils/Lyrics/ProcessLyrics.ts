import { franc } from "franc-all";
import langs from "langs";
import { RetrievePackage } from "../ImportPackage.ts";
import Logger from "../Logger.ts";
import { convertChineseLyricsText } from "./ChineseCharacterConversion.ts";
import { $chineseCharacterForm } from "../uiState.ts";
import { $googleSoundFallback, $soundTargetOrthography } from "../stores.ts";
import { chineseTones, chineseTranslitMode, cyrillicKeepSigns, cyrillicRomanizationMode, joinMandarinWords, koreanDisplayMode } from "./lyrics.ts";
import {
  ChineseTextTest,
  JapaneseTextTest,
  KoreanTextTest,
  CyrillicTextTest,
  GreekTextTest,
  cleanInvisibles,
  cleanInvisiblesPreserveEdges,
} from "./Fork/index.ts";
import {
  romanizationBranchFromLanguage,
  resolveCjkDocumentBranch,
  resolveCjkLineRoute,
  scriptBranchForLine,
  SCRIPT_PRIORITY,
  type CjkReadingBranch,
  type RomanizationBranch,
  type ScriptBranchDocContext,
} from "./Fork/TextDetection.ts";
import {
  buildMandarinWordLayout,
  joinMandarinReadingWords,
  romanizeCantonese,
  romanizeCyrillic,
  romanizeKoreanForDisplay,
  romanizeMandarin,
} from "./Fork/Romanization.ts";
import { acceptRomanization } from "./Fork/RomanizationAcceptance.ts";
import { buildJapaneseLineTextMap } from "./Reading/JapaneseReading.ts";
import { translateLyrics, clearTranslationCache, googleTransliterateLines } from "./Fork/Translation.ts";
import { DefaultCanonicalLineBuilder } from "./Processing/Canonical.ts";
import { annotateKoreanLine } from "./Processing/Korean/KoreanAnnotationProcessor.ts";
import { DefaultRenderPlanBuilder, validateRenderPlan } from "./Processing/RenderPlan.ts";
import { japaneseDictionariesReady, processJapanesePackageLine, processJapanesePackageTextTarget } from "./Processing/Japanese/JapanesePackageProcessor.ts";
import { buildLineFallbackPlan, buildTimedGenericPlan } from "./Processing/GenericReadingProcessor.ts";
import { romanizeChineseDominantCjkText } from "./Processing/CjkLanguageRouting.ts";
import type { ParsedLine } from "./Processing/Model.ts";
import { canonicalTextFromSyllables } from "./Processing/ProviderBoundary.ts";

export { clearTranslationCache };
export { acceptRomanization };
export const LYRICS_PROCESSING_VERSION = 34;
export const READING_PLAN_SCHEMA_VERSION = 2;

// Constants
const romanizationLogger = new Logger("Lyrics Romanization");

const getLyricsPageContainer = (): HTMLElement | null =>
  typeof document === "undefined" ? null : document.querySelector<HTMLElement>("#SpicyLyricsPage");

// Per-item (1-char) presence tests. Once a script is confirmed present in the
// whole song, a single matching character in an item is enough to romanize it.
const ItemJapaneseTest = /[぀-ヿ一-鿿]/;
const ItemChineseTest = /[一-鿿]/;
const ItemKoreanTest = KoreanTextTest;
const ItemCyrillicTest = /[Ѐ-ӿԀ-ԯⷠ-ⷿꙀ-ꚟ]/;
const ItemGreekTest = GreekTextTest;
const ScriptResidualTests: Record<RomanizationBranch, RegExp> = {
  Japanese: ItemJapaneseTest,
  Chinese: ItemChineseTest,
  Korean: ItemKoreanTest,
  Cyrillic: ItemCyrillicTest,
  Greek: ItemGreekTest,
};

// Any original (non-Latin) romanizable script — used in dev to flag residue.
const ResidualScriptTest = /[぀-ヿ一-鿿가-힯ᄀ-ᇿ㄰-㆏Ѐ-ԯͰ-Ͽἀ-῿]/;

// Load Packages
RetrievePackage("GreekRomanization", "1.0.0", "js").catch(() => {});

type RomanizationPackages = {
  greekRomanization?: any;
};

const loadPackagesForScripts = async (
  scripts: RomanizationBranch[]
): Promise<RomanizationPackages> => {
  const packages: RomanizationPackages = {};
  for (const script of scripts) {
    if (script === "Greek") {
      packages.greekRomanization = await RetrievePackage("GreekRomanization", "1.0.0", "js");
    }
  }
  return packages;
};

const romanizeChineseText = async (
  text: string,
  primaryLanguage: string
): Promise<string> => {
  if (chineseTranslitMode === "jyutping") {
    return (await romanizeCantonese(text, primaryLanguage, true, chineseTones)) ?? text;
  }
  return romanizeMandarin(text, chineseTones);
};

const romanizeKoreanText = (text: string): string => romanizeKoreanForDisplay(text, koreanDisplayMode).display;

const romanizeCyrillicText = (text: string): string =>
  romanizeCyrillic(text, cyrillicRomanizationMode, cyrillicKeepSigns);

const romanizeGreekText = (text: string, greekRomanization: any): string => {
  if (!greekRomanization) return text;
  const result = greekRomanization.default(text);
  return result != null ? result : text;
};

type RomanizeEntry = { target: any; line: any; lineText: string };

const normalizeLyricsText = (target: any): string => {
  if (typeof target?.Text !== "string") return "";
  target.Text = cleanInvisibles(target.Text.normalize("NFKC"));
  return target.Text;
};

const normalizeSyllableText = (target: any): string => {
  if (typeof target?.Text !== "string") return "";
  target.Text = cleanInvisiblesPreserveEdges(target.Text.normalize("NFKC"));
  return target.Text;
};

const resolveSyllableGroupText = (group: any, lineId: string, fallbackDisplayText = ""): string => {
  const syllables = Array.isArray(group?.Syllables) ? group.Syllables : [];
  for (const syllable of syllables) normalizeSyllableText(syllable);
  const rawDisplayText = typeof group?.Text === "string" ? group.Text : fallbackDisplayText;
  const displayText = typeof rawDisplayText === "string"
    ? cleanInvisiblesPreserveEdges(rawDisplayText.normalize("NFKC")) : "";
  const resolution = canonicalTextFromSyllables(syllables, displayText, lineId);
  const joins = new Map(resolution.canonical.joins.map((join) => [join.afterSpanId, join]));
  resolution.canonical.spanMappings.forEach((mapping, index) => {
    const syllable = syllables[index];
    if (!syllable) return;
    const join = joins.get(mapping.spanId);
    syllable.CanonicalStartCp = mapping.canonicalRange.startCp;
    syllable.CanonicalEndCp = mapping.canonicalRange.endCp;
    syllable.BoundaryAfter = join?.relation === "boundary";
    syllable.BoundaryProvenance = join?.provenance || "lineEnd";
  });
  group.Text = resolution.canonical.text;
  return resolution.canonical.text;
};

const gatherText = (
  lyrics: any
): { francText: string; scriptText: string; entries: RomanizeEntry[] } => {
  const entries: RomanizeEntry[] = [];
  const textLines: string[] = [];
  const bgTextLines: string[] = [];

  if (lyrics.Type === "Static") {
    for (const line of lyrics.Lines) {
      const lineText = normalizeLyricsText(line);
      entries.push({ target: line, line, lineText });
      textLines.push(lineText);
    }
  } else if (lyrics.Type === "Line") {
    for (const vocalGroup of lyrics.Content) {
      if (vocalGroup.Type === "Vocal" || vocalGroup.Text) {
        const lineText = normalizeLyricsText(vocalGroup);
        entries.push({ target: vocalGroup, line: vocalGroup, lineText });
        textLines.push(lineText);
      }
    }
  } else if (lyrics.Type === "Syllable") {
    for (const vocalGroup of lyrics.Content) {
      if (vocalGroup.Type !== undefined && vocalGroup.Type !== "Vocal") continue;

      const syllables = vocalGroup.Lead.Syllables;
      if (syllables.length > 0) {
        const text = resolveSyllableGroupText(vocalGroup.Lead,
          `lead-${vocalGroup.Lead.StartTime ?? 0}-${vocalGroup.Lead.EndTime ?? 0}`,
          vocalGroup.Text || "");
        const lineEntries: RomanizeEntry[] = syllables.map((syllable: any) => ({
          target: syllable, line: vocalGroup, lineText: text,
        }));
        entries.push(...lineEntries);
        textLines.push(text);
      }

      if (vocalGroup.Background !== undefined) {
        for (const bg of vocalGroup.Background) {
          const bgEntries: RomanizeEntry[] = [];
          for (const syllable of bg.Syllables) {
            normalizeSyllableText(syllable);
            bgEntries.push({ target: syllable, line: vocalGroup, lineText: "" });
          }
          const lineText = resolveSyllableGroupText(bg,
            `background-${bg.StartTime ?? 0}-${bg.EndTime ?? 0}`);
          for (const entry of bgEntries) entry.lineText = lineText;
          entries.push(...bgEntries);
          bgTextLines.push(lineText);
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
  iso2Language: string | undefined,
  cjkDominantBranch: CjkReadingBranch | undefined
): RomanizationBranch[] => {
  const present = new Set<RomanizationBranch>();

  if (JapaneseTextTest.test(scriptText)) present.add("Japanese");
  if (ChineseTextTest.test(scriptText)) present.add(cjkDominantBranch || "Chinese");
  if (KoreanTextTest.test(scriptText)) present.add("Korean");
  if (CyrillicTextTest.test(scriptText)) present.add("Cyrillic");
  if (GreekTextTest.test(scriptText)) present.add("Greek");

  const hint = romanizationBranchFromLanguage(language, iso2Language);
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

const shouldReplaceKoreanTransliteration = (entry: RomanizeEntry, docContext: ScriptBranchDocContext): boolean =>
  scriptBranchForLine(entry.lineText || entry.target?.Text || "", docContext).includes("Korean")
  && ItemKoreanTest.test(entry.target?.Text || "");

const lyricsHaveAnyTransliteration = (lyrics: any): boolean => {
  if (lyrics.Type === "Static") {
    return lyrics.Lines?.some((line: any) => hasTransliteration(line) || typeof line.RomanizedText === "string"
      || line.ReadingRenderPlan != null) === true;
  }
  if (lyrics.Type === "Line") {
    return lyrics.Content?.some((line: any) => hasTransliteration(line) || typeof line.RomanizedText === "string"
      || line.ReadingRenderPlan != null) === true;
  }
  if (lyrics.Type === "Syllable") {
    return lyrics.Content?.some((group: any) =>
      hasTransliteration(group.Lead) ||
      typeof group.Lead?.RomanizedText === "string" ||
      group.Lead?.Syllables?.some((s: any) => hasTransliteration(s) || typeof s.RomanizedText === "string") === true ||
      group.Lead?.ReadingRenderPlan != null ||
      group.Background?.some((bg: any) =>
        hasTransliteration(bg) ||
        typeof bg.RomanizedText === "string" ||
        bg.Syllables?.some((s: any) => hasTransliteration(s) || typeof s.RomanizedText === "string") === true
        || bg.ReadingRenderPlan != null
      ) === true
    ) === true;
  }
  return false;
};

const romanizeLineText = async (
  text: string,
  docContext: ScriptBranchDocContext,
  packages: RomanizationPackages,
  language: string
): Promise<string | undefined> => {
  const entry: RomanizeEntry = { target: { Text: text }, line: {}, lineText: text };
  const changed = await romanizeEntry(entry, docContext, packages, language, false);
  return changed ? entry.target.TransliteratedText : undefined;
};

const postProcessSyllableRomanization = async (
  lyrics: any,
  docContext: ScriptBranchDocContext,
  packages: RomanizationPackages,
  language: string
) => {
  if (lyrics.Type !== "Syllable") return;

  for (const vocalGroup of lyrics.Content || []) {
    if (vocalGroup.Type !== undefined && vocalGroup.Type !== "Vocal") continue;

    const processGroup = async (group: any, fallbackDisplayText = "") => {
      const syllables = group?.Syllables;
      if (!Array.isArray(syllables) || syllables.length === 0) return;

      const groupHasKorean = syllables.some((s: any) => KoreanTextTest.test(s.Text || ""));
      const lineText = resolveSyllableGroupText(group,
        `processed-${group.StartTime ?? 0}-${group.EndTime ?? 0}`, fallbackDisplayText);
      const cjkLineRoute = resolveCjkLineRoute(lineText, docContext);
      const isJapaneseLine = cjkLineRoute === "Japanese";
      const isChineseLine = cjkLineRoute === "Chinese" || cjkLineRoute === "MixedChinese";
      const japaneseMap = isJapaneseLine && !groupHasKorean
        ? buildJapaneseLineTextMap(syllables, lineText) : undefined;
      const effectiveLineText = japaneseMap?.lineText ?? lineText;
      if (groupHasKorean) {
        const parsed: ParsedLine = {
          id: `korean-${group.StartTime ?? 0}-${group.EndTime ?? 0}`,
          displayText: effectiveLineText,
          paragraphProvenance: "unavailable",
          spans: syllables.map((syllable: any, index: number) => ({
            id: String(index),
            rawText: syllable.Text || "",
            cleanText: syllable.Text || "",
            startMs: Number(syllable.StartTime || 0),
            endMs: Number(syllable.EndTime || 0),
            providerPartOfWord: typeof syllable.IsPartOfWord === "boolean"
              ? syllable.IsPartOfWord : undefined,
          })),
        };
        const canonical = new DefaultCanonicalLineBuilder().build(parsed);
        const plan = new DefaultRenderPlanBuilder().build(parsed, canonical, [
          annotateKoreanLine(canonical, koreanDisplayMode),
        ]);
        if (validateRenderPlan(plan).valid) {
          group.ReadingRenderPlan = plan;
          delete group.RomanizedText;
          delete group.TransliteratedText;
          for (const syllable of syllables) {
            delete syllable.RomanizedText;
            delete syllable.TransliteratedText;
            delete syllable.RomajiSpaceBefore;
          }
          return;
        }
      }
      // Dictionaries are fetched at runtime, so they can be unavailable. Falling
      // through to generic romanization keeps the line rendering without furigana
      // rather than failing the whole lyric render.
      if (isJapaneseLine && !groupHasKorean && japaneseMap && (await japaneseDictionariesReady())) {
        const packageResult = await processJapanesePackageLine(effectiveLineText, syllables, japaneseMap.spans, syllables);
        for (const syllable of syllables) {
          delete syllable.RomanizedText;
          delete syllable.TransliteratedText;
          delete syllable.RomajiSpaceBefore;
        }
        group.JapaneseReading = { sourceText: effectiveLineText, romaji: packageResult.romaji, furigana: packageResult.plan.furigana || [] };
        group.ReadingRenderPlan = packageResult.plan;
        delete group.RomanizedText;
        delete group.TransliteratedText;
        return;
      }
      const fullRomaji = await romanizeLineText(effectiveLineText, docContext, packages, language);
      if (!fullRomaji) return;

      group.TransliteratedText = fullRomaji;
      group.RomanizedText = fullRomaji;

      {
        for (let index = 0; index < syllables.length; index += 1) {
          const syllable = syllables[index];
          if (syllable.TransliteratedText && !syllable.RomanizedText) {
            syllable.RomanizedText = syllable.TransliteratedText;
          }
          if (isChineseLine && index > 0 && syllable.RomanizedText) {
            syllable.RomajiSpaceBefore = true;
          }
        }
        const mandarinWordLayout =
          cjkLineRoute === "Chinese" && chineseTranslitMode === "pinyin" && joinMandarinWords
            ? buildMandarinWordLayout(effectiveLineText)
            : undefined;
        const plan = buildTimedGenericPlan(
          group,
          fullRomaji,
          isChineseLine ? "Chinese" : "Generic",
          { mandarinWordLayout },
        );
        if (plan) {
          group.ReadingRenderPlan = plan;
          delete group.RomanizedText;
          delete group.TransliteratedText;
          for (const syllable of syllables) {
            delete syllable.RomanizedText;
            delete syllable.TransliteratedText;
            delete syllable.RomajiSpaceBefore;
          }
        }
      }
    };

    await processGroup(vocalGroup.Lead, vocalGroup.Text || "");
    for (const bg of vocalGroup.Background || []) {
      await processGroup(bg);
    }
  }
};

const romanizeEntry = async (
  entry: RomanizeEntry,
  docContext: ScriptBranchDocContext,
  packages: RomanizationPackages,
  primaryLanguage: string,
  annotateJapanese: boolean = true
): Promise<boolean> => {
  const { target, line } = entry;

  if (target.Text) {
    const normalized = target.Text.normalize("NFKC");
    target.Text = annotateJapanese
      ? cleanInvisibles(normalized)
      : cleanInvisiblesPreserveEdges(normalized);
  }
  const cjkLineRoute = resolveCjkLineRoute(entry.lineText || target.Text || "", docContext);
  const targetDocContext = cjkLineRoute === "Japanese"
    ? { ...docContext, cjkDominantBranch: "Japanese" as const }
    : docContext;
  const lineScripts = scriptBranchForLine(target.Text || "", targetDocContext);
  const replaceKoreanTransliteration = shouldReplaceKoreanTransliteration(entry, docContext);

  if (hasTransliteration(target) && !replaceKoreanTransliteration) {
    if (annotateJapanese && cjkLineRoute === "Japanese" && lineScripts.includes("Japanese") && ItemJapaneseTest.test(target.Text || "")) {
      const previousPlan = target.ReadingRenderPlan?.joinedDisplayText;
      const packageRomaji = await processJapanesePackageTextTarget(target);
      return packageRomaji !== previousPlan;
    }
    return true;
  }

  let text: string = target.Text;
  let changed = false;

  if (annotateJapanese && cjkLineRoute === "Japanese" && lineScripts.includes("Japanese") && ItemJapaneseTest.test(target.Text || "")) {
    const packageRomaji = await processJapanesePackageTextTarget(target);
    if (packageRomaji && acceptRomanization(target.Text || "", packageRomaji, [ScriptResidualTests.Japanese])) {
      line.HasTransliterations = true;
      return true;
    }
  }

  const chineseDominantCjk =
    docContext.cjkDominantBranch === "Chinese" &&
    cjkLineRoute !== "Japanese" &&
    (ItemChineseTest.test(text) || JapaneseTextTest.test(text));
  if (chineseDominantCjk) {
    text = await romanizeChineseDominantCjkText(text, {
      romanizeHan: (run) => romanizeChineseText(run, primaryLanguage),
      romanizeKana: async (run) => {
        const target = { Text: run };
        return processJapanesePackageTextTarget(target);
      },
    });
    changed = text !== target.Text;
  }

  for (const script of lineScripts) {
    if (chineseDominantCjk && (script === "Japanese" || script === "Chinese")) {
      continue;
    } else if (script === "Japanese") {
      continue;
    } else if (script === "Chinese") {
      if (ItemChineseTest.test(text)) {
        text = await romanizeChineseText(text, primaryLanguage);
        changed = true;
      }
    } else if (script === "Korean") {
      if (ItemKoreanTest.test(text)) {
        text = romanizeKoreanText(text);
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
    if (ResidualScriptTest.test(text)) {
      romanizationLogger.warn("Incomplete romanization (original-script characters remain)", {
        original: target.Text,
        romanized: text,
      });
    }
    if (!acceptRomanization(target.Text || "", text, lineScripts.map((script) => ScriptResidualTests[script]))) {
      return false;
    }
    target.TransliteratedText = text;
    target.RomanizedText = text;
    line.HasTransliterations = true;
  }

  return changed;
};

export const ProcessLyrics = async (
  lyrics: any,
  options: { updatePageClasses?: boolean; awaitTranslation?: boolean } = {}
) => {
  lyrics.ProcessingVersion = LYRICS_PROCESSING_VERSION;
  lyrics.ReadingPlanSchemaVersion = READING_PLAN_SCHEMA_VERSION;
  const updatePageClasses = options.updatePageClasses !== false;
  const awaitTranslation = options.awaitTranslation !== false;
  const hadApiTransliterations = lyrics.HasTransliterations === true;
  let gathered = gatherText(lyrics);
  const detectedLanguage = franc(gathered.francText);
  const detectedLanguageISO2 = langs.where("3", detectedLanguage)?.["1"];
  const cjkDominantBranch = resolveCjkDocumentBranch(
    gathered.scriptText,
    detectedLanguage,
    detectedLanguageISO2,
  );
  const language = cjkDominantBranch === "Japanese"
    ? "jpn"
    : cjkDominantBranch === "Chinese"
      ? detectedLanguage === "yue" ? "yue" : "cmn"
      : detectedLanguage;
  const languageISO2 = langs.where("3", language)?.["1"];
  lyrics.Language = language;
  lyrics.LanguageISO2 = languageISO2;

  const presentScripts = detectPresentScripts(
    gathered.scriptText,
    language,
    languageISO2,
    cjkDominantBranch,
  );
  const docContext: ScriptBranchDocContext = {
    presentScripts,
    primaryLanguage: language,
    iso2Language: languageISO2,
    cjkDominantBranch,
  };
  const chineseCharacterForm = $chineseCharacterForm.get();
  lyrics.ChineseCharacterForm = chineseCharacterForm;
  if (chineseCharacterForm !== "original" && presentScripts.includes("Chinese")) {
    convertChineseLyricsText(
      lyrics,
      chineseCharacterForm,
      (text) => ItemChineseTest.test(text) && scriptBranchForLine(text, docContext).includes("Chinese"),
    );
    gathered = gatherText(lyrics);
  }
  const entries = gathered.entries;

  let appliedRomanization = false;
  let packages: RomanizationPackages = {};
  const needsRomanizationOrJapaneseReading = entries.some((entry) =>
    !hasTransliteration(entry.target) ||
    shouldReplaceKoreanTransliteration(entry, docContext) ||
    (
      scriptBranchForLine(entry.lineText, docContext).includes("Japanese") &&
      ItemJapaneseTest.test(entry.target.Text || "") &&
      !entry.target.JapaneseReading
    )
  );
  if (presentScripts.length > 0 && needsRomanizationOrJapaneseReading) {
    packages = await loadPackagesForScripts(presentScripts);
    const results = await Promise.all(
      entries.map((entry) => romanizeEntry(entry, docContext, packages, language, lyrics.Type !== "Syllable"))
    );
    appliedRomanization = results.some(Boolean);
  }

  if ($googleSoundFallback.get() && $soundTargetOrthography.get() === "Latin" && lyrics.Type !== "Syllable") {
    const missing = entries.map((entry, index) => !hasTransliteration(entry.target) ? index : -1).filter((index) => index >= 0);
    if (missing.length > 0) {
      const fallback = await googleTransliterateLines(missing.map((index) => entries[index].lineText), language);
      fallback.forEach((reading, offset) => {
        if (!reading) return;
        entries[missing[offset]].target.RomanizedText = reading;
        entries[missing[offset]].target.RomanizationSource = "google";
        appliedRomanization = true;
      });
    }
  }

  if (presentScripts.length > 0) {
    if (Object.keys(packages).length === 0) packages = await loadPackagesForScripts(presentScripts);
    await postProcessSyllableRomanization(lyrics, docContext, packages, language);
    if (lyrics.Type !== "Syllable") {
      entries.forEach((entry, index) => {
        if (entry.target.ReadingRenderPlan) return;
        let display = entry.target.RomanizedText || entry.target.TransliteratedText;
        if (!display) return;
        const cjkLineRoute = resolveCjkLineRoute(entry.lineText || entry.target.Text || "", docContext);
        if (joinMandarinWords && chineseTranslitMode === "pinyin" && cjkLineRoute === "Chinese") {
          display = joinMandarinReadingWords(entry.target.Text || "", display);
        }
        entry.target.ReadingRenderPlan = buildLineFallbackPlan(entry.target.Text || "", display, `line-${index}`);
        delete entry.target.RomanizedText;
        delete entry.target.TransliteratedText;
      });
    }
  }

  const hasAnyTransliteration = lyricsHaveAnyTransliteration(lyrics);
  lyrics.IncludesRomanization = hadApiTransliterations || appliedRomanization || hasAnyTransliteration;
  lyrics.HasTransliterations = hadApiTransliterations || appliedRomanization || hasAnyTransliteration;
  lyrics.DetectedChinese = presentScripts.includes("Chinese");

  if (updatePageClasses) {
    const pageContainer = getLyricsPageContainer();
    if (lyrics.HasTransliterations === true) {
      pageContainer?.classList.add("Lyrics_RomanizationAvailable");
    } else {
      pageContainer?.classList.remove("Lyrics_RomanizationAvailable");
    }

    if (lyrics.DetectedChinese) {
      pageContainer?.classList.add("Lyrics_ChineseDetected");
    } else {
      pageContainer?.classList.remove("Lyrics_ChineseDetected");
    }
  }

  if (awaitTranslation) {
    await translateLyrics(lyrics);
    if (updatePageClasses) {
      const pageContainer = getLyricsPageContainer();
      if (lyrics.IncludesTranslation === true) {
        pageContainer?.classList.add("Lyrics_TranslationAvailable");
      } else {
        pageContainer?.classList.remove("Lyrics_TranslationAvailable");
      }
    }
  }
};
