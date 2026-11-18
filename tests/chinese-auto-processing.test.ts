import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { franc } from "franc-all";
import langs from "langs";
import * as detection from "../src/utils/Lyrics/Fork/TextDetection.ts";
import * as romanization from "../src/utils/Lyrics/Fork/Romanization.ts";
import * as plans from "../src/utils/Lyrics/Processing/GenericReadingProcessor.ts";
import { acceptRomanization } from "../src/utils/Lyrics/Fork/RomanizationAcceptance.ts";
import { resolveSyllableGroupBoundaries } from "../src/utils/Lyrics/Processing/ProviderBoundary.ts";
import { StripEmptyLyricsLines } from "../src/utils/Lyrics/EmptyLines.ts";
import { romanizeChineseDominantCjkText } from "../src/utils/Lyrics/Processing/CjkLanguageRouting.ts";
import { isAudioChineseMode, isRhymeChineseMode, resolveChineseTranslitMode, type ChineseTranslitMode, type ChineseLanguage } from "../src/utils/Lyrics/ChineseTranslitMode.ts";
import { guessChineseFromRhymes } from "../src/utils/Lyrics/ChineseRhymeGuess.ts";
import { convertChineseLyricsText } from "../src/utils/Lyrics/ChineseCharacterConversion.ts";
import { ensureMandarinSegmenter } from "../src/utils/Lyrics/Fork/MandarinEzaLine.ts";
import { mandarinTimedChunks } from "../src/utils/Lyrics/Processing/ChineseTimedChunks.ts";

// Exercise the real processor and reading plans. Replace its Spotify/UI imports and unused services.
const source = readFileSync(new URL("../src/utils/Lyrics/ProcessLyrics.ts", import.meta.url), "utf8").replace(/^import[\s\S]*?;\n/gm, "");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function processor() {
  const context = {
    ...detection, ...romanization, ...plans, franc, langs, acceptRomanization, StripEmptyLyricsLines,
    resolveSyllableGroupBoundaries,
    romanizeChineseDominantCjkText,
    convertChineseLyricsText,
    ensureMandarinSegmenter, mandarinTimedChunks,
    Logger: class { warn() {} },
    RetrievePackage: async () => ({}),
    $chineseCharacterForm: { get: () => "original" },
    $googleSoundFallback: { get: () => false },
    $soundTargetOrthography: { get: () => "Latin" },
    chineseTranslitMode: "auto" as ChineseTranslitMode,
    isAudioChineseMode, isRhymeChineseMode, guessChineseFromRhymes, recordChineseDetection: () => {},
    resolvedChineseMode: (mode: ChineseTranslitMode, _uri: string, lyrics: any) => {
      if (isAudioChineseMode(mode)) {
        return resolveChineseTranslitMode(mode, context.audioDecided
          ? context.audioLanguage
          : lyrics?.ChineseRhymeGuess?.language ?? context.audioLanguage);
      }
      return resolveChineseTranslitMode(mode, lyrics?.ChineseRhymeGuess?.language);
    },
    audioDecided: false,
    audioLanguage: "yue" as ChineseLanguage,
    chineseTones: true, chineseReadingPlacement: "lineBelow", joinMandarinWords: false,
    translateLyrics: async () => {}, clearTranslationCache: () => {},
    exports: {} as { ProcessLyrics?: (document: any, options?: any) => Promise<void> },
    document: undefined,
  };
  runInNewContext(compiled, context);
  return { context, process: context.exports.ProcessLyrics! };
}

function document(type: "Static" | "Line" | "Syllable") {
  const line = { Text: "你好香港", TransliteratedText: "incorrect provider reading", StartTime: 0, EndTime: 5 };
  if (type === "Static") return { uri: "spotify:track:test", Type: type, Lines: [line] };
  if (type === "Line") return { uri: "spotify:track:test", Type: type, Content: [{ ...line, Type: "Vocal" }] };
  return { uri: "spotify:track:test", Type: type, Content: [{ Type: "Vocal", Lead: {
    StartTime: 0, EndTime: 5, Syllables: Array.from(line.Text, (Text, i) => ({ Text, StartTime: i, EndTime: i + 1,
      TransliteratedText: "incorrect provider reading", IsPartOfWord: false })),
  } }] };
}

for (const type of ["Static", "Line", "Syllable"] as const) {
  test(`${type} auto processing replaces provider readings and rebuilds cached plans after detection`, async () => {
    const { context, process } = processor();
    const lyrics = document(type);
    const target = () => type === "Static" ? (lyrics as any).Lines[0]
      : type === "Line" ? (lyrics as any).Content[0] : (lyrics as any).Content[0].Lead;
    for (const [mode, language, expected, attachedKind] of [
      ["auto", "yue", "nei5 hou2 hoeng1 gong2", "cantoneseJyutping"],
      ["auto-vn", "yue", "nẻi hóu hỡong kóng", "cantoneseVnAid"],
      ["auto-vn", "cmn", "ní hảo shiang kảng", "mandarinVnAid"],
      ["auto", "cmn", "nǐ hǎo xiāng gǎng", "mandarinPinyin"],
    ] as const) {
      context.chineseTranslitMode = mode;
      context.audioDecided = true;
      context.audioLanguage = language;
      context.chineseReadingPlacement = "lineBelow";
      await process(lyrics, { updatePageClasses: false });
      assert.equal(target().ReadingRenderPlan.joinedDisplayText, expected);
      assert.equal((lyrics as any).Language, language);
      assert.equal((lyrics as any).ResolvedChineseTranslitMode, resolveChineseTranslitMode(mode, language));
      context.chineseReadingPlacement = "wordAbove";
      await process(lyrics, { updatePageClasses: false });
      assert.equal(target().ReadingRenderPlan.attachedReadings[0].kind, attachedKind);
    }
  });

  test(`${type} rhyme mode uses the full lyric document independently of the audio language`, async () => {    const { context, process } = processor();
    context.chineseTranslitMode = "rhyme-vn";
    context.audioLanguage = "cmn";
    const texts = [
      "為了她又再勉強去談天論愛", "又再振作去慰解他人", "如難復合便盡早放開凡事看開",
      "又再講沒有情人時還可自愛", "忘掉或是為自己感慨", "笑住說沉淪那些苦海會有害",
      "因為我堅強到利用自己的痛心轉換成愛心", "抵我對她操心已記不起我也有權利愛人",
      "誰人曾照顧過我的感受", "待我溫柔吻過我傷口", "能得到的安慰是失戀者得救後",
      "很感激忠誠的狗", "誰人曾介意我也不好受", "為我出頭碰過我的手",
      "重生者走得的都走誰人又為天使憂愁",
    ];
    const lyrics: any = { uri: "spotify:track:test", Type: type };
    if (type === "Static") lyrics.Lines = texts.map((Text) => ({ Text }));
    else if (type === "Line") lyrics.Content = texts.map((Text) => ({ Type: "Vocal", Text }));
    else lyrics.Content = texts.map((Text, i) => ({ Type: "Vocal", Lead: {
      Syllables: Array.from(Text, (Text, j) => ({ Text, StartTime: i * 10 + j, EndTime: i * 10 + j + 1 })),
    } }));
    await process(lyrics, { updatePageClasses: false });
    assert.equal(lyrics.ChineseRhymeGuess.language, "yue");
    assert.equal(lyrics.ResolvedChineseTranslitMode, "jyutping-vn");
    assert.equal(lyrics.Language, "yue");
    context.chineseTranslitMode = "rhyme";
    await process(lyrics, { updatePageClasses: false });
    assert.equal(lyrics.ResolvedChineseTranslitMode, "jyutping");
    context.chineseTranslitMode = "auto";
    context.audioDecided = false;
    await process(lyrics, { updatePageClasses: false });
    assert.equal(lyrics.ResolvedChineseTranslitMode, "jyutping");
    assert.equal(lyrics.ChineseRhymeGuess.language, "yue");
    context.audioDecided = true;
    context.audioLanguage = "cmn";
    await process(lyrics, { updatePageClasses: false });
    assert.equal(lyrics.ResolvedChineseTranslitMode, "pinyin");
  });
}

for (const type of ["Static", "Syllable"] as const) {
  test(`${type} simplified display reads Jyutping from the provider source (R1)`, async () => {
    const { context, process } = processor();
    context.chineseTranslitMode = "auto";
    context.audioDecided = true;
    context.audioLanguage = "yue";
    context.chineseReadingPlacement = "lineBelow";
    context.$chineseCharacterForm = { get: () => "simplified" };
    const text = "不願離開 只願留低";
    const lyrics: any = { uri: "spotify:track:test", Type: type };
    if (type === "Static") lyrics.Lines = [{ Text: text }];
    else lyrics.Content = [{ Type: "Vocal", Lead: {
      StartTime: 0, EndTime: 5, Syllables: Array.from(text, (Text, i) => ({
        Text, StartTime: i, EndTime: i + 1, IsPartOfWord: false,
      })),
    } }];
    await process(lyrics, { updatePageClasses: false });
    const target = () => type === "Static" ? lyrics.Lines[0] : lyrics.Content[0].Lead;
    assert.equal(target().Text.replace(/\s+/gu, ""), "不愿离开只愿留低");
    // 離 must read lei4 from 不願離開, not ci1 from the simplified display character.
    assert.equal(
      target().ReadingRenderPlan.joinedDisplayText,
      "bat1 jyun6 lei4 hoi1 zi2 jyun6 lau4 dai1",
    );
  });
}
