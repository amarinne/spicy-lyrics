import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { guessChineseFromRhymes } from "../src/utils/Lyrics/ChineseRhymeGuess.ts";
import { isAudioChineseMode, resolveChineseTranslitMode } from "../src/utils/Lyrics/ChineseTranslitMode.ts";
import { CHINESE_AUDIO_REVISION, ChineseAudioDetector } from "../src/utils/Lyrics/ChineseAudioDetection.ts";

// "容易受傷的女人" (Faye Wong): twelve usable lines. Under the old exact-final key the endings
// rhymed better under Mandarin (eleven Mandarin-only pairs, no Cantonese-only pair). Revision 4
// groups -m/-n and -p/-t, so the Cantonese reading now rhymes at least as well.
const canto = [
  "人漸醉了夜更深 在這一刻多麼接近", "思想彷似在搖撼 矛盾也更深", "曾被破碎過的心 讓你今天輕輕貼近",
  "多少安慰及疑問 偷偷的再生", "情難自禁 我卻其實屬於 極度容易受傷的女人", "不要 不要 不要驟來驟去 請珍惜我的心",
  "如明白我 繼續情願熱戀 這個容易受傷的女人", "不要等 這一刻 請熱吻", "長夜有你醉也真 讓我終於找到信任",
  "不管一切是疑問 快樂是情人", "曾害怕了這一生 是你始終甘心靠近", "我方知擁有著緣份 重建我信心",
  "曾被破碎過的心 讓你今天輕輕貼近",
];
// "花海" (Jay Chou): Mandarin lyrics whose endings also rhyme under Jyutping.
const mando = [
  "靜止了 所有的花開", "遙遠了 清晰了愛", "天鬱悶 愛卻很喜歡", "那時候我不懂這叫愛",
  "妳喜歡 站在那窗台", "妳好久 都沒再來", "彩色的 時間染上空白", "是妳流的淚暈開",
  "不要妳離開 距離隔不開", "思念變成海 在窗外進不來", "原諒說太快 愛成了阻礙",
  "手中的風箏放太快 回不來", "不要妳離開 回憶劃不開", "欠妳的寵愛 我在等待重來",
];

test("tone parallelism and rhyme together guess each language in both output styles", () => {
  assert.equal(guessChineseFromRhymes(canto).language, "yue");
  assert.equal(guessChineseFromRhymes(mando).language, "cmn");
  assert.equal(resolveChineseTranslitMode("rhyme", guessChineseFromRhymes(canto).language), "jyutping");
  assert.equal(resolveChineseTranslitMode("rhyme-vn", guessChineseFromRhymes(canto).language), "jyutping-vn");
  assert.equal(resolveChineseTranslitMode("rhyme-vn", guessChineseFromRhymes(mando).language), "pinyin-vn");
});

test("grouped Cantonese rhyme keys keep the Cantonese reading ahead", () => {
  const result = guessChineseFromRhymes(canto);
  // 深/近/撼/再生/人/心/吻/任/信/人/近: -m and -n share a group, so neither reading owns an
  // exclusive pair, and the Jyutping z still clears the Mandarin z.
  assert.equal(result.cantoneseOnlyPairs, 0);
  assert.equal(result.mandarinOnlyPairs, 0);
  assert.equal(result.jyutpingZ! > result.mandarinZ!, true);
  assert.equal(result.cantoneseMarkers, 0);
  assert.equal(result.language, "yue");
  assert.equal(result.probability! > 0.9, true);
});

test("short or non-Chinese text stays uncertain", () => {
  const shortCanto = ["為了她又再勉強去談天論愛", "又再振作去慰解他人", "如難復合便盡早放開凡事看開",
    "又再講沒有情人時還可自愛", "忘掉或是為自己感慨", "笑住說沉淪那些苦海會有害"];
  for (const lines of [[], ["你好"], ["English only", "♪"], shortCanto]) {
    const result = guessChineseFromRhymes(lines);
    assert.equal(result.language, undefined);
    assert.equal(resolveChineseTranslitMode("rhyme", result.language), "pinyin");
  }
});

test("Cantonese function characters outweigh contradictory line-ending rhymes", () => {
  // Real "不需要挽留（Move On）" lines: strong Cantonese markers, yet Mandarin-only rhymes win
  // the line-ending comparison. Marker evidence has to override it.
  const moveOn = [
    "過咗幾年之後我都依然無變", "遇到不公平嘅待遇依然好戰", "但是發現你已不在我嘅身邊",
    "因為當初對你講了太多嘅謊言", "朋友話我很久沒見好似一夜長大", "堅持自我天真世界發展太快",
    "重新相遇不會比你見到我嘅挫敗", "回憶往事太多無意義嘅錯怪", "仲記得以前你就睡在我的枕邊",
    "每晚睡覺是對一日結束後嘅沉澱", "直到今時今日 深夜我會習慣眼淺", "一瞬間的恍然代表最青葱嘅思念",
    "每一步嘅腳印本來都會由你見證", "但是現在只我獨自一人被迫清醒", "面對所有事情我已慢慢變得正經",
    "遠處望向我嘅背影出現你嘅身影",
  ];
  const result = guessChineseFromRhymes(moveOn);
  assert.equal(result.language, "yue");
  assert.equal(result.mandarinOnlyPairs > result.cantoneseOnlyPairs, true);
  assert.equal(result.cantoneseMarkers >= 2, true);
});

test("literary Cantonese lyrics resolve from rhyme evidence alone", () => {
  // "七友" (Edmond Leung) is written in standard written Chinese: not one Cantonese function
  // character, and its endings produce no Jyutping-only pairs (C=0), which is why the old
  // exclusive-pair rule fell through to Pinyin. The Jyutping reading still explains the rhymes
  // better than Mandarin once both are measured against their own chance collision rate.
  const seven = [
    "為了她又再勉強去談天論愛", "又再振作去慰解他人", "如難復合便盡早放開凡事看開",
    "又再講沒有情人時還可自愛", "忘掉或是為自己感慨", "笑住說沉淪那些苦海會有害",
    "因為我堅強到利用自己的痛心轉換成愛心", "抵我對她操心已記不起我也有權利愛人",
    "誰人曾照顧過我的感受", "待我溫柔吻過我傷口", "能得到的安慰是失戀者得救後",
    "很感激忠誠的狗", "誰人曾介意我也不好受", "為我出頭碰過我的手",
    "重生者走得的都走誰人又為天使憂愁", "甜言蜜語沒有但卻有我這個好友",
    "直到她又再告訴我重新被愛", "又再看透了我的將來",
  ];
  const result = guessChineseFromRhymes(seven);
  assert.equal(result.cantoneseMarkers, 0);
  assert.equal(result.cantoneseOnlyPairs, 0);
  assert.equal(result.language, "yue");
});

test("Mandarin lyrics whose rhymes also fit Jyutping stay Mandarin", () => {
  // "花海" (Jay Chou): the Jyutping reading rhymes at least as tightly, so a bare collision count
  // would call this Cantonese. It must not.
  const flowerSea = [
    "靜止了 所有的花開", "遙遠了 清晰了愛", "天鬱悶 愛卻很喜歡", "那時候我不懂這叫愛",
    "妳喜歡 站在那窗台", "妳好久 都沒再來", "彩色的 時間染上空白", "是妳流的淚暈開",
    "不要妳離開 距離隔不開", "思念變成海 在窗外進不來", "原諒說太快 愛成了阻礙",
    "手中的風箏放太快 回不來", "不要妳離開 回憶劃不開", "欠妳的寵愛 我在等待重來",
  ];
  const result = guessChineseFromRhymes(flowerSea);
  assert.equal(result.language, "cmn");
  assert.equal(resolveChineseTranslitMode("rhyme", result.language), "pinyin");
});

test("a single Cantonese character cannot decide a track on its own", () => {
  // One 嘅 is worth 3.03 of logit: enough to move a Mandarin song off a confident call, never
  // enough to call it Cantonese. Two distinct markers are the threshold.
  const mandarin = [...mando, "我嘅心中一點"];
  assert.equal(guessChineseFromRhymes(mandarin).cantoneseMarkers, 1);
  assert.notEqual(guessChineseFromRhymes(mandarin).language, "yue");
});

test("Hangul lines are not counted as Han evidence", () => {
  // 红蔷薇白玫瑰 (G.E.M.) contains a Korean hook. The compatibility-ideograph range starts at
  // U+F900; spelling it from 豈 (U+8C48) would swallow Hangul and add a phantom line.
  const base = guessChineseFromRhymes(mando);
  const mixed = guessChineseFromRhymes([...mando, "사랑해 (사랑해) 사랑해 (사랑해)"]);
  assert.equal(mixed.lineCount, base.lineCount);
});

test("ambiguous characters shared with Mandarin never count as Cantonese markers", () => {
  // 曬 (shài), 郁, 咩, 畀 and 俾 all occur in Mandarin text; they must not decide a language.
  const ambiguous = ["久未放晴的天空", "依舊留著妳的笑容", "哭過 卻無法掩埋歉疚", "曬過的衣服很香", "鬱悶的心情感覺"];
  const result = guessChineseFromRhymes(ambiguous);
  assert.equal(result.cantoneseMarkers, 0);
  assert.notEqual(result.language, "yue");
});

test("timestamps, credit lines and repeated choruses cannot inflate rhyme evidence", () => {
  const expected = guessChineseFromRhymes(canto);
  const result = guessChineseFromRhymes([
    "作詞：月色留心", "作曲: 夜色轉暗", ...canto.map((line, i) => `[00:0${i}.00]${line}`), ...canto,
  ]);
  assert.deepEqual(result, expected);
  assert.equal(guessChineseFromRhymes(Array(20).fill("月色留心")).language, undefined);
});

test("the audio runtime never captures in rhyme mode and cancels a pending audio request on switching", async () => {
  const source = readFileSync(new URL("../src/utils/Lyrics/ChineseAudioRuntime.ts", import.meta.url), "utf8").replace(/^import[\s\S]*?;\n/gm, "");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  let mode = "rhyme";
  let status = "waiting";
  let tick: () => void;
  let requests = 0;
  let pendingSignal: AbortSignal;
  let resolveRequest: (value: any) => void;
  let saves = 0;
  const uri = "spotify:track:" + "a".repeat(22);
  const context = {
    exports: {} as any, AbortController, Date, CHINESE_AUDIO_REVISION, ChineseAudioDetector, TextEncoder,
    isAudioChineseMode, CHINESE_AUDIO_ENDPOINT: "http://test.invalid",
    chineseAudioLyricLines: () => [], recordChineseAudio: () => {},
    $chineseTranslitMode: { get: () => mode, listen: () => () => {} },
    $chineseAudioStatus: { get: () => status, set: (value: string) => { status = value; } },
    $currentLyricsData: { get: () => JSON.stringify({ uri, DetectedChinese: true }) },
    SpotifyPlayer: { GetUri: () => uri, GetPosition: () => 0, IsPlaying: true },
    hasChineseAudioDecision: () => false,
    saveChineseAudioDecision: () => { saves++; },
    setInterval: (callback: () => void) => { tick = callback; return 1; },
    clearInterval: () => {}, window: { addEventListener: () => {} },
    fetch: (_url: string, request: { signal: AbortSignal }) => {
      requests++;
      pendingSignal = request.signal;
      return new Promise((resolve) => { resolveRequest = resolve; });
    },
  };
  runInNewContext(compiled, context);
  context.exports.startChineseAudioDetection();
  tick!();
  mode = "rhyme-vn";
  tick!();
  assert.equal(requests, 0);
  mode = "auto";
  tick!();
  assert.equal(requests, 1);
  mode = "rhyme";
  tick!();
  assert.equal(pendingSignal!.aborted, true);
  resolveRequest!({ ok: true, json: async () => ({ uri, revision: CHINESE_AUDIO_REVISION, logOdds: -5 }) });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(requests, 1);
  assert.equal(saves, 0);
});
