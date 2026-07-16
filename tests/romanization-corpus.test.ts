import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildKoreanLineTextFromSyllables,
  pinyinOptionsForToneMode,
  pronounceKoreanHangul,
  romanizeKorean,
  romanizeKoreanDisplayPieces,
  romanizeKoreanForDisplay,
  romanizeKoreanSyllableLine,
  romanizeKoreanSyllablePieces,
  romanizeCantonese,
  romanizeCyrillic,
  stripJyutpingTones,
} from "../src/utils/Lyrics/Fork/Romanization.ts";
import { cleanInvisibles, cleanInvisiblesPreserveEdges, scriptBranchForLine } from "../src/utils/Lyrics/Fork/TextDetection.ts";
import {
  buildKoreanNormalizedLine,
  buildKoreanReadingPlan,
} from "../src/utils/Lyrics/Processing/Korean/KoreanReadingProcessor.ts";

const japaneseSongContext = {
  presentScripts: ["Japanese"] as const,
  primaryLanguage: "jpn",
  iso2Language: "ja",
};

const chineseSongContext = {
  presentScripts: ["Chinese"] as const,
  primaryLanguage: "zho",
  iso2Language: "zh",
};

const koreanSongContext = {
  presentScripts: ["Korean"] as const,
  primaryLanguage: "kor",
  iso2Language: "ko",
};

test("invisible lyric markers are cleaned before processing", () => {
  assert.equal(cleanInvisibles("This \u200Bis \u200Ba test"), "This is a test");
  assert.equal(cleanInvisibles("tell \u200Bme"), "tell me");
  assert.equal(cleanInvisibles("\uFEFFhello\u00A0world"), "hello world");
  assert.equal(cleanInvisibles("\u0915\u094D\u200D\u0937"), "\u0915\u094D\u200D\u0937");
  assert.equal(cleanInvisiblesPreserveEdges("go \u200B"), "go ");
});

test("romanization branch selection is line-scoped", () => {
  assert.deepEqual(
    scriptBranchForLine("Алдадыңбы", {
      presentScripts: ["Cyrillic"],
      primaryLanguage: "eng",
      iso2Language: "en",
    }),
    ["Cyrillic"]
  );
  assert.deepEqual(
    scriptBranchForLine("Let's go!", {
      presentScripts: ["Japanese"],
      primaryLanguage: "jpn",
      iso2Language: "ja",
    }),
    []
  );
  assert.deepEqual(
    scriptBranchForLine("全宇宙全世界", {
      presentScripts: ["Japanese"],
      primaryLanguage: "jpn",
      iso2Language: "ja",
    }),
    ["Japanese"]
  );
  assert.deepEqual(
    scriptBranchForLine("텅 빈 말 더는 늘어놓지 말고", {
      presentScripts: ["Korean"],
      primaryLanguage: "kor",
      iso2Language: "ko",
    }),
    ["Korean"]
  );
});

test("real mixed and glued lyric lines select per-line romanization branches", () => {
  assert.deepEqual(scriptBranchForLine("だんだん剥がれてく Fake のゴールドメッキ", japaneseSongContext), ["Japanese"]);
  assert.deepEqual(scriptBranchForLine("说不出的sorry", chineseSongContext), ["Chinese"]);
  assert.deepEqual(scriptBranchForLine("Tonight 이제 너를 놓아줄게", koreanSongContext), ["Korean"]);
});

test("Latin apostrophe and vocable lines do not select a romanization branch", () => {
  assert.deepEqual(scriptBranchForLine("It's fxxking hard to say it, goodbye", japaneseSongContext), []);
  assert.deepEqual(scriptBranchForLine("Hoo, ah, ah", chineseSongContext), []);
  assert.deepEqual(scriptBranchForLine("Whoa, whoa 我在每 夜 徹 夜 狂 想", chineseSongContext), ["Chinese"]);
});

test("Cantonese Jyutping phrase corpus", async () => {
  assert.equal(
    await romanizeCantonese("上堂終於講到分數", "yue", true, true),
    "soeng5 tong4 zung1 jyu1 gong2 dou3 fan1 sou3"
  );
  assert.equal(
    await romanizeCantonese("開會剩低嘅嘢我會搞掂㗎喇", "yue", true, true),
    "hoi1 wui2 zing6 dai1 ge3 je5 ngo5 wui5 gaau2 dim6 gaa3 laa3"
  );
  assert.equal(await romanizeCantonese("香港A", "yue", true, true), "hoeng1 gong2 A");
});

test("Chinese tone toggle strips only Jyutping tone digits", async () => {
  assert.equal(await romanizeCantonese("你好", "yue", true, true), "nei5 hou2");
  assert.equal(await romanizeCantonese("你好", "yue", true, false), "nei hou");
  assert.equal(stripJyutpingTones("nei5 hou2 remix 2026"), "nei hou remix 2026");
});

test("Chinese tone toggle selects pinyin style when the package exposes constants", () => {
  const pinyin = { STYLE_TONE: 1, STYLE_NORMAL: 0 };
  assert.deepEqual(pinyinOptionsForToneMode(pinyin, true), { segment: true, group: false, style: 1 });
  assert.deepEqual(pinyinOptionsForToneMode(pinyin, false), { segment: true, group: false, style: 0 });
  assert.deepEqual(pinyinOptionsForToneMode({}, true), { segment: true, group: false });
});

test("Korean spelling-mode corpus", () => {
  assert.equal(romanizeKorean("음악", "spelling"), "eumak");
  assert.equal(romanizeKorean("한국어", "spelling"), "hangukeo");
  assert.equal(romanizeKorean("학교", "spelling"), "hakgyo");
  assert.equal(romanizeKorean("백마", "spelling"), "baekma");
  assert.equal(romanizeKorean("안녕하세요", "spelling"), "annyeong haseyo");
  assert.equal(romanizeKorean("사랑", "spelling"), "sarang");
  assert.equal(romanizeKorean("BTS feat. IU", "spelling"), "BTS feat. IU");
});

test("Korean pronunciation-mode corpus", () => {
  assert.equal(romanizeKorean("음악", "pronunciation"), "eumak");
  assert.equal(romanizeKorean("한국어", "pronunciation"), "hangugeo");
  assert.equal(romanizeKorean("강아지", "pronunciation"), "gangaji");
  assert.equal(romanizeKorean("해돋이", "pronunciation"), "haedoji");
  assert.equal(romanizeKorean("같이", "pronunciation"), "gachi");
  assert.equal(romanizeKorean("백마", "pronunciation"), "baengma");
  assert.equal(romanizeKorean("국물", "pronunciation"), "gungmul");
  assert.equal(romanizeKorean("색연필", "pronunciation"), "saengnyeonpil");
  assert.equal(romanizeKorean("꽃잎", "pronunciation"), "kkonnip");
  assert.equal(romanizeKorean("독립", "pronunciation"), "dongnip");
  assert.equal(romanizeKorean("신라", "pronunciation"), "silla");
  assert.equal(romanizeKorean("종로", "pronunciation"), "jongno");
  assert.equal(romanizeKorean("있는", "pronunciation"), "inneun");
  assert.equal(romanizeKorean("좋고", "pronunciation"), "joko");
  assert.equal(romanizeKorean("좋아", "pronunciation"), "joa");
  assert.equal(romanizeKorean("많다", "pronunciation"), "manta");
  assert.equal(romanizeKorean("싫지", "pronunciation"), "silchi");
  assert.equal(romanizeKorean("닫히다", "pronunciation"), "dachida");
  assert.equal(romanizeKorean("맞히다", "pronunciation"), "machida");
  assert.equal(romanizeKorean("음악 rock", "pronunciation"), "eumak rock");
});

test("Korean readability spacing", () => {
  assert.equal(romanizeKorean("안녕하세요", "spelling"), "annyeong haseyo");
  assert.equal(romanizeKorean("안녕하세요", "pronunciation"), "annyeong haseyo");
  assert.equal(romanizeKorean("텅 빈 말 더는 늘어놓지 말고", "spelling"), "teong bin mal deoneun neuleonotji malgo");
  assert.equal(romanizeKorean("감사합니다", "spelling"), "gamsa hapnida");
});

test("Korean real-line corpus", () => {
  assert.equal(romanizeKorean("더 이상 기댈 곳은 필요 없어", "spelling"), "deo isang gidael goteun pilyo eopseo");
  assert.equal(romanizeKorean("더 이상 기댈 곳은 필요 없어", "pronunciation"), "deo isang gidael goseun piryo eopsseo");

  const repeated = "Had enough? Had enough? Oh";
  assert.equal(romanizeKorean(repeated, "spelling"), "Had enough? Had enough? Oh");
  assert.equal(romanizeKorean(repeated, "spelling"), romanizeKorean(repeated, "spelling"));
});

test("Korean spelling block mode matches written Hangul blocks", () => {
  assert.equal(
    romanizeKorean("엉키는 마음은 꿈에서 다 잊게", "spelling", "rr", true),
    "eong-ki-neun ma-eum-eun kkum-e-seo da it-ge"
  );
  assert.equal(
    romanizeKorean("영원처럼 안아 줘", "spelling", "vn", true),
    "yong-won-cho-rom an-a jwo"
  );
  assert.equal(
    romanizeKorean("주저 없이 다, Probably delete it", "spelling", "vn", true),
    "ju-jo ops-i da, Probably delete it"
  );
  assert.equal(romanizeKorean("한국어", "spelling", "rr", true), "han-guk-eo");
});

test("Korean Vietnamese-style vowel output", () => {
  assert.equal(romanizeKorean("어", "spelling", "vn"), "o");
  assert.equal(romanizeKorean("오", "spelling", "vn"), "ô");
  assert.equal(romanizeKorean("우", "spelling", "vn"), "u");
  assert.equal(romanizeKorean("으", "spelling", "vn"), "ư");
  assert.equal(romanizeKorean("에", "spelling", "vn"), "ê");
  assert.equal(romanizeKorean("애", "spelling", "vn"), "ê");
});

test("Korean Vietnamese-style output uses post-G2P jamo state", () => {
  assert.equal(romanizeKorean("한국어", "pronunciation", "vn"), "hangugo");
  assert.equal(romanizeKorean("백마", "pronunciation", "vn"), "bêngma");
  assert.equal(romanizeKorean("해돋이", "pronunciation", "vn"), "hêdôji");
  assert.equal(romanizeKorean("같이", "pronunciation", "vn"), "gachi");
  assert.equal(romanizeKorean("국물", "pronunciation", "vn"), "gungmul");
  assert.equal(romanizeKorean("색연필", "pronunciation", "vn"), "sêngnyonpil");
  assert.equal(romanizeKorean("꽃잎", "pronunciation", "vn"), "kkônnip");
  assert.equal(romanizeKorean("독립", "pronunciation", "vn"), "dôngnip");
  assert.equal(romanizeKorean("신라", "pronunciation", "vn"), "silla");
  assert.equal(romanizeKorean("종로", "pronunciation", "vn"), "jôngnô");
  assert.equal(romanizeKorean("있는", "pronunciation", "vn"), "innưn");
  assert.equal(romanizeKorean("좋고", "pronunciation", "vn"), "jôkô");
  assert.equal(romanizeKorean("좋아", "pronunciation", "vn"), "jôa");
  assert.equal(romanizeKorean("어떻게", "pronunciation", "vn"), "ottokê");
  assert.equal(romanizeKorean("의사", "pronunciation", "vn"), "ưisa");
  assert.equal(romanizeKorean("희망", "pronunciation", "vn"), "himang");
  assert.equal(romanizeKorean("희미하다", "pronunciation", "vn"), "himihada");
  assert.equal(romanizeKorean("무늬", "pronunciation", "vn"), "muni");
  assert.equal(romanizeKorean("나의", "pronunciation", "vn"), "naê");
  assert.equal(romanizeKorean("너의", "pronunciation", "vn"), "noê");
  assert.equal(romanizeKorean("우리의", "pronunciation", "vn"), "uriê");
  assert.equal(romanizeKorean("많다", "pronunciation", "vn"), "manta");
  assert.equal(romanizeKorean("싫지", "pronunciation", "vn"), "silchi");
  assert.equal(romanizeKorean("닫히다", "pronunciation", "vn"), "dachida");
  assert.equal(romanizeKorean("맞히다", "pronunciation", "vn"), "machida");
  assert.equal(romanizeKorean("없이", "pronunciation", "vn"), "opssi");
  assert.equal(romanizeKorean("낮의", "pronunciation", "vn", true), "najê");
  assert.equal(romanizeKorean("내 네 개 게", "pronunciation", "vn", true), "nê nê gê gê");
  assert.equal(romanizeKorean("왜 외 웨", "pronunciation", "vn", true), "wê wê wê");
});

test("Korean display modes map to expected extra-line output", () => {
  assert.equal(romanizeKoreanForDisplay("한국어", "wordTranslit").display, "han-guk-eo");
  assert.equal(romanizeKoreanForDisplay("눈빛", "rrStandard").display, "nunbit");
  assert.equal(romanizeKoreanForDisplay("감출 수 있게", "rrPronunciation").display, "gamchul-ssu itkke");
  assert.equal(romanizeKoreanForDisplay("주저 없이 다, Probably delete it", "vnPronunciation").display, "jujo opssi da, Probably delete it");
});

test("Korean TTML word-level spans preserve eojeol spacing for display romanization", () => {
  const spansWithTextSpaces = ["그대 ", "아무런 ", "말", "도 ", "하", "지 ", "마", "요"].map((Text) => ({
    Text,
    IsPartOfWord: false,
  }));
  const spansWithContinuationMarkers = [
    { Text: "그대", IsPartOfWord: false },
    { Text: "아무런", IsPartOfWord: false },
    { Text: "말", IsPartOfWord: true },
    { Text: "도", IsPartOfWord: false },
    { Text: "하", IsPartOfWord: true },
    { Text: "지", IsPartOfWord: false },
    { Text: "마", IsPartOfWord: true },
    { Text: "요", IsPartOfWord: false },
  ];

  for (const spans of [spansWithTextSpaces, spansWithContinuationMarkers]) {
    const source = buildKoreanLineTextFromSyllables(spans);
    assert.equal(source, "그대 아무런 말도 하지 마요");
    assert.equal(romanizeKoreanForDisplay(source, "vnPronunciation").display, "gưdê amuron maldô haji mayô");

    const pieces = romanizeKoreanSyllablePieces(source, "vn");
    const mapped = [];
    let searchFrom = 0;
    for (const span of spans) {
      const text = span.Text.trim();
      const start = source.indexOf(text, searchFrom);
      const pieceStart = Array.from(source.slice(0, start)).length;
      mapped.push(pieces.slice(pieceStart, pieceStart + Array.from(text).length).join(""));
      searchFrom = start + text.length;
    }
    assert.deepEqual(mapped, ["gưdê", "amuron", "mal", "dô", "ha", "ji", "ma", "yô"]);
  }
});

test("Korean display pieces follow selected mode for synced remap", () => {
  assert.deepEqual(
    romanizeKoreanDisplayPieces("뜨거워진 온도 탓일까요", "wordTranslit").filter((piece) => piece !== " "),
    ["tteu", "geo", "wo", "jin", "on", "do", "tat", "il", "kka", "yo"]
  );
  assert.equal(romanizeKoreanDisplayPieces("뜨거워진 온도 탓일까요", "rrStandard").join(""), "tteugeowojin ondo tasilkkayo");
  assert.equal(romanizeKoreanDisplayPieces("뜨거워진 온도 탓일까요", "rrPronunciation").join(""), "tteugeowojin ondo tasilkkayo");
  assert.equal(romanizeKoreanDisplayPieces("뜨거워진 온도 탓일까요", "vnPronunciation").join(""), "ttưgowojin ôndô tasilkkayô");
});

test("Korean word-level synced spans recover spaces when IsPartOfWord is unreliable", () => {
  const line = buildKoreanLineTextFromSyllables(
    ["미련이", "아냐,", "그저", "Hard", "to", "see", "it"].map((Text) => ({ Text, IsPartOfWord: true }))
  );
  assert.equal(line, "미련이 아냐, 그저 Hard to see it");
  assert.equal(romanizeKoreanForDisplay(line, "vnPronunciation").display, "miryoni anya, gưjo Hard to see it");

  const secondLine = buildKoreanLineTextFromSyllables(
    ["처음부터", "잘못됐단", "걸"].map((Text) => ({ Text, IsPartOfWord: true }))
  );
  assert.equal(secondLine, "처음부터 잘못됐단 걸");
  assert.equal(romanizeKoreanForDisplay(secondLine, "vnPronunciation").display, "choưmbuto jalmôt-ttwêt-ttan gol");
});

test("Korean TTML spans split across p blocks preserve missing eojeol space", () => {
  const line = buildKoreanLineTextFromSyllables(
    ["더 ", "이", "상 ", "기", "댈 ", "곳", "은", "필", "요 ", "없", "어"].map((Text) => ({ Text, IsPartOfWord: false }))
  );
  assert.equal(line, "더 이상 기댈 곳은 필요 없어");
  assert.equal(romanizeKoreanForDisplay(line, "vnPronunciation").display, "do isang gidêl gôsưn piryô opsso");
});

test("Korean normalized source maps timed spans with code-point ranges", () => {
  const spans = ["더 ", "이", "상 ", "기", "댈 ", "곳", "은", "필", "요 ", "없", "어"].map((Text) => ({
    Text,
    IsPartOfWord: false,
  }));
  const normalized = buildKoreanNormalizedLine(spans);

  assert.equal(normalized.text, "더 이상 기댈 곳은 필요 없어");
  assert.deepEqual(normalized.spans.map((span) => [span.spanId, span.source.startCp, span.source.endCp]), [
    [0, 0, 1],
    [1, 2, 3],
    [2, 3, 4],
    [3, 5, 6],
    [4, 6, 7],
    [5, 8, 9],
    [6, 9, 10],
    [7, 11, 12],
    [8, 12, 13],
    [9, 14, 15],
    [10, 15, 16],
  ]);
  assert.deepEqual(normalized.boundaries.map((boundary) => boundary.offsetCp), [1, 4, 7, 10, 13]);

  const astral = buildKoreanNormalizedLine([
    { Text: "😀 ", IsPartOfWord: false },
    { Text: "한국", IsPartOfWord: false },
  ]);
  assert.equal(astral.text, "😀 한국");
  assert.deepEqual(astral.spans.map((span) => span.source), [
    { startCp: 0, endCp: 1 },
    { startCp: 2, endCp: 4 },
  ]);
});

test("Korean reading plan separates logical groups from timed span assignments", () => {
  const spans = ["그대 ", "아무런 ", "말", "도 ", "하", "지 ", "마", "요"].map((Text) => ({
    Text,
    IsPartOfWord: false,
  }));
  const plan = buildKoreanReadingPlan(spans, "vnPronunciation");

  assert.equal(plan.displayText, "gưdê amuron maldô haji mayô");
  assert.deepEqual(plan.groups.map((group) => group.spanIds), [[0], [1], [2, 3], [4, 5], [6, 7]]);
  assert.deepEqual(plan.groups.map((group) => group.spaceBefore), [false, true, true, true, true]);
  assert.deepEqual(plan.spanReadings.map((reading) => reading.text), ["gưdê", "amuron", "mal", "dô", "ha", "ji", "ma", "yô"]);
  assert.deepEqual(plan.spanReadings.map((reading) => reading.spaceBefore), [false, true, true, false, true, false, true, false]);

});

test("Korean reading plan keeps mixed English spans aligned after eojeol rejoin", () => {
  const texts = ["주", "저", "없", "이", "다,", "Probably", "delete", "it"];
  const partOfWord = [false, true, false, true, false, false, false, false];
  const spans = texts.map((Text, index) => ({ Text, IsPartOfWord: partOfWord[index] }));
  const plan = buildKoreanReadingPlan(spans, "vnPronunciation");

  assert.equal(plan.normalized.text, "주저 없이 다, Probably delete it");
  assert.equal(plan.displayText, "jujo opssi da, Probably delete it");
  assert.deepEqual(plan.groups.map((group) => group.spanIds), [[0, 1], [2, 3], [4], [5], [6], [7]]);
  assert.deepEqual(plan.spanReadings.map((reading) => reading.text), [
    "ju", "jo", "op", "ssi", "da,", "Probably", "delete", "it",
  ]);

});

test("Korean reading plan does not shift a trailing English sentence", () => {
  const spans = ["더", "이", "상", "기", "댈", "곳", "은", "필", "요", "없", "어", "When", "you", "hold", "me", "tight"]
    .map((Text) => ({ Text, IsPartOfWord: false }));
  const plan = buildKoreanReadingPlan(spans, "vnPronunciation");

  assert.equal(plan.normalized.text, "더 이상 기댈 곳은 필요 없어 When you hold me tight");
  assert.equal(plan.displayText, "do isang gidêl gôsưn piryô opsso When you hold me tight");
  assert.deepEqual(plan.spanReadings.slice(-5).map((reading) => reading.text), ["When", "you", "hold", "me", "tight"]);
});

const koreanRulesetCorpus = [
  ["Basic ㅓ/ㅗ/ㅜ contrast", "어떻게 오토 우투", "eotteoke oto utu", "ottokê ôtô utu"],
  ["ㅢ after consonant -> 이", "희미하다", "himihada", "himihada"],
  ["져/쪄/쳐 -> 저/쩌/처", "다쳐", "dacheo", "dacho"],
  ["final neutralization", "꽃", "kkot", "kkôt"],
  ["final ㅍ -> ㅂ", "앞", "ap", "ap"],
  ["final ㅅ/ㅆ/ㅈ/ㅊ/ㅌ -> ㄷ: 옷", "옷", "ot", "ôt"],
  ["final ㅅ/ㅆ/ㅈ/ㅊ/ㅌ -> ㄷ: 빛", "빛", "bit", "bit"],
  ["final ㅅ/ㅆ/ㅈ/ㅊ/ㅌ -> ㄷ: 밭", "밭", "bat", "bat"],
  ["double batchim ㅄ", "값이", "gapssi", "gapssi"],
  ["liaison with ㅊ", "꽃을", "kkocheul", "kkôchưl"],
  ["liaison with ㄱ", "한국어", "hangugeo", "hangugo"],
  ["ㅎ aspiration: ㅎ + ㄱ", "좋고", "joko", "jôkô"],
  ["ㅎ aspiration: ㄶ + ㄷ", "않던", "anteon", "anton"],
  ["consonant + ㅎ aspiration", "입학", "ipak", "ipak"],
  ["ㅎ deletion before vowel", "좋아", "joa", "jôa"],
  ["obstruent + ㄱ/ㄷ/ㅂ/ㅅ/ㅈ tensification", "국밥", "gukppap", "gukppap"],
  ["obstruent + ㄷ tensification", "먹다", "meoktta", "moktta"],
  ["final ㅆ + ㄱ tensification", "있고", "itkko", "itkkô"],
  ["adnominal ㄹ tensification", "할 수", "hal ssu", "hal ssu"],
  ["Sino-Korean ㄹ tensification", "갈등", "galtteung", "galttưng"],
  ["compound tensification", "눈동자", "nunttongja", "nunttôngja"],
  ["nasalization ㄱ->ㅇ before ㄴ/ㅁ", "국물", "gungmul", "gungmul"],
  ["nasalization ㄷ->ㄴ before ㄴ/ㅁ", "있는", "inneun", "innưn"],
  ["nasalization ㅂ->ㅁ before ㄴ/ㅁ", "앞마당", "ammadang", "ammadang"],
  ["ㄹ -> ㄴ after ㅁ/ㅇ", "심리", "simni", "simni"],
  ["ㄹ -> ㄴ after ㅇ", "종로", "jongno", "jôngnô"],
  ["ㄴ + ㄹ -> ㄹㄹ", "신라", "silla", "silla"],
  ["ㄹ + ㄴ -> ㄹㄹ", "설날", "seollal", "sollal"],
  ["palatalization ㄷ + 이 -> 지", "굳이", "guji", "guji"],
  ["palatalization ㅌ + 이 -> 치", "같이", "gachi", "gachi"],
  ["ㄷ + 히 -> 치", "닫히다", "dachida", "dachida"],
  ["ㄴ insertion", "색연필", "saengnyeonpil", "sêngnyonpil"],
  ["ㄴ insertion + nasalization", "꽃잎", "kkonnip", "kkônnip"],
  ["ㄴ insertion", "한여름", "hanyeoreum", "hanyorưm"],
  ["ㄴ insertion", "솜이불", "somnibul", "sômnibul"],
  ["final unreleased stop", "밥", "bap", "bap"],
  ["ㄹ display: intervocalic r", "사랑", "sarang", "sarang"],
  ["ㄹ display: final l", "날", "nal", "nal"],
  ["ㄹㄹ display", "몰라", "molla", "môlla"],
  ["spacing override", "감출 수 있게", "gamchul ssu itkke", "gamchul ssu itkkê"],
] as const;

test("Korean NIKL-style pronunciation ruleset corpus", () => {
  for (const [rule, input, rr, vn] of koreanRulesetCorpus) {
    assert.equal(romanizeKorean(input, "pronunciation", "rr"), rr, rule);
    assert.equal(romanizeKorean(input, "pronunciation", "vn"), vn, rule);
  }
});

test("Korean pronounced-Hangul oracle isolates G2P and override coverage", () => {
  const cases = [
    ["앉다", "안따"],
    ["읽고", "일꼬"],
    ["맑게", "말께"],
    ["젊다", "점따"],
    ["밟다", "밥따"],
    ["핥다", "할따"],
    ["눈빛", "눈삗"],
    ["문법", "문뻡"],
    ["발달", "발딸"],
    ["뒷일", "뒨닐"],
    ["갈 곳", "갈 꼳"],
    ["갈 데가 없어", "갈 떼가 업써"],
  ] as const;

  for (const [input, expected] of cases) {
    assert.equal(pronounceKoreanHangul(input), expected, input);
  }
});

test("Korean VN renderer maps pronounced Hangul independently of G2P", () => {
  const cases = [
    ["말께", "mal-kkê"],
    ["조코", "jô-kô"],
    ["주이", "ju-i"],
    ["주의", "ju-ưi"],
    ["시게", "si-gê"],
    ["서울력", "so-ul-ryok"],
    ["종노", "jông-nô"],
  ] as const;

  for (const [pronounced, expected] of cases) {
    assert.equal(romanizeKorean(pronounced, "spelling", "vn", true), expected, pronounced);
  }
});

test("Korean separator policy stays separate from G2P", () => {
  const cases = [
    ["돌아갈 수", "dôragal-ssu"],
    ["감출 수 있게", "gamchul-ssu itkkê"],
    ["먹을 게", "mogưl-kkê"],
    ["볼 거야", "bôl kkoya"],
    ["갈 곳", "gal-kkôt"],
    ["눈동자", "nunttôngja"],
    ["아침밥", "achimppap"],
  ] as const;

  for (const [input, expected] of cases) {
    assert.equal(romanizeKorean(input, "pronunciation", "vn", true), expected, input);
  }
});

// Junction hyphen policy goldens (approved 2026-07-12): hyphen only for
// sound-ambiguous n|g / ng|vowel-glide junctions, RR vowel-digraph junctions,
// and triple same-letter collisions. Doubles stay joined; sound-identical
// liaisons (miryeoni) stay joined.
const koreanJunctionPolicyCorpus = [
  // [hangul, rr, vn]
  ["마요", "mayo", "mayô"],
  ["같이", "gachi", "gachi"],
  ["먹어", "meogeo", "mogo"],
  ["없어", "eopsseo", "opsso"],
  ["없지", "eopjji", "opjji"],
  ["좋다", "jota", "jôta"],
  ["축하", "chuka", "chuka"],
  ["미련이", "miryeoni", "miryoni"],
  ["아무런", "amureon", "amuron"],
  ["말이", "mari", "mari"],
  ["종로", "jongno", "jôngnô"],
  ["생각", "saenggak", "sênggak"],
  ["강원", "gang-won", "gang-won"],
  ["한국말", "han-gungmal", "han-gungmal"],
  ["한국", "han-guk", "han-guk"],
  ["해운대", "hae-undae", "hêundê"],
  ["처음", "cheo-eum", "choưm"],
  ["악기", "ak-kki", "ak-kki"],
  ["신라", "silla", "silla"],
  ["잘못됐단", "jalmot-ttwaet-ttan", "jalmôt-ttwêt-ttan"],
] as const;

test("Korean junction hyphen policy corpus", () => {
  for (const [hangul, rr, vn] of koreanJunctionPolicyCorpus) {
    assert.equal(romanizeKorean(hangul, "pronunciation", "rr", true), rr, `${hangul} rr`);
    assert.equal(romanizeKorean(hangul, "pronunciation", "vn", true), vn, `${hangul} vn`);
  }
});

const koreanRulesetKnownGaps = [
  ["possessive 의 -> 에 uses VN ㅔ", "우리의", "uriê"],
  ["non-initial 의 may -> 이", "주의", "jui"],
  ["ㅖ may simplify to ㅔ", "시계", "sigê"],
  ["liaison ㅅ before i display option", "옷이", "ôshi"],
  ["ㅅ before i/y display option", "시간", "shigan"],
] as const;

for (const [rule, input, expectedVn] of koreanRulesetKnownGaps) {
  test(`Korean ruleset TODO: ${rule}`, { todo: "accepted variant or morphology/dictionary gap" }, () => {
    assert.equal(romanizeKorean(input, "pronunciation", "vn"), expectedVn);
  });
}

test("Korean Vietnamese-style separators preserve lyric chunks", () => {
  assert.equal(
    romanizeKorean("어떻게든 날 감출 수 있게", "pronunciation", "vn", true),
    "ottokêdưn nal gamchul-ssu itkkê"
  );
  assert.equal(
    romanizeKorean("나로 다시 돌아갈 수 있게", "pronunciation", "vn", true),
    "narô dasi dôragal-ssu itkkê"
  );
  assert.equal(
    romanizeKorean("호기심은 위험하단 걸", "pronunciation", "vn", true),
    "hôgisimưn wihomhadan gol"
  );
  assert.equal(
    romanizeKorean("점점 내 모습이 희미해져", "pronunciation", "vn", true),
    "jomjom nê môsưbi himihêjo"
  );
  assert.equal(
    romanizeKorean("주저 없이 다, Probably delete it", "pronunciation", "vn", true),
    "jujo opssi da, Probably delete it"
  );
});

test("Korean separators normalize syllable-spaced tokenizer output", () => {
  assert.equal(
    romanizeKorean("어 떻 게 든 날 감 출 수 있 게", "pronunciation", "vn", true),
    "ottokêdưn nal gamchul-ssu itkkê"
  );
  assert.equal(
    romanizeKorean("나 로 다 시 돌 아 갈 수 있 게", "pronunciation", "vn", true),
    "narô dasi dôragal-ssu itkkê"
  );
  assert.equal(
    romanizeKorean("호 기 심 은 위 험 하 단 걸", "pronunciation", "vn", true),
    "hôgisimưn wihomhadan gol"
  );
  assert.equal(
    romanizeKorean("점 점 내 모 습 이 희 미 해 져", "pronunciation", "vn", true),
    "jomjom nê môsưbi himihêjo"
  );
  assert.equal(
    romanizeKorean("뒤 돌 아 서 너 를 볼 수 없 게", "pronunciation", "vn", true),
    "dwidôraso norưl bôl-ssu opkkê"
  );
  assert.equal(
    romanizeKorean("더 이 상 기 댈 곳 은 필 요 없 어 When you hold me tight", "pronunciation", "vn", true),
    "do isang gidêl gôsưn piryô opsso When you hold me tight"
  );
  assert.equal(
    romanizeKorean("너 는 없 을 거 야", "pronunciation", "vn", true),
    "nonưn opssưl kkoya"
  );
  assert.equal(
    romanizeKorean("늘 넌 없 을 거 야", "pronunciation", "vn", true),
    "nưl non opssưl kkoya"
  );
  assert.equal(
    romanizeKorean("주 저 없 이 다, Probably delete it", "pronunciation", "vn", true),
    "jujo opssi da, Probably delete it"
  );
  assert.equal(
    romanizeKorean("멀 리 날 아 가", "pronunciation", "vn", true),
    "molli naraga"
  );
});

test("Korean syllable pieces preserve full-line pronunciation context", () => {
  assert.deepEqual(romanizeKoreanSyllablePieces("한국어", "rr"), ["han", "gu", "geo"]);
  assert.deepEqual(romanizeKoreanSyllablePieces("백마", "rr"), ["baeng", "ma"]);
  assert.deepEqual(romanizeKoreanSyllablePieces("멀리 날아가", "vn"), ["mol", "li", " ", "na", "ra", "ga"]);
});

test("Korean syllable pipeline preserves separators and mixed-script spacing", () => {
  assert.equal(
    romanizeKoreanSyllableLine(
      "뒤 돌아 서 너 를 볼 수 없 게".split(" ").map((Text) => ({ Text, IsPartOfWord: false })),
      "pronunciation",
      "vn",
      true
    ),
    "dwidôraso norưl bôl-ssu opkkê"
  );
  assert.equal(
    romanizeKoreanSyllableLine(
      "주 저 없 이 다 , Probably delete it".split(" ").map((Text) => ({ Text, IsPartOfWord: false })),
      "pronunciation",
      "vn",
      true
    ),
    "jujo opssi da, Probably delete it"
  );
  assert.equal(
    romanizeKoreanSyllableLine(
      [
        ..."더 이상 기댈 곳은 필요 없어".split(" ").map((Text) => ({ Text, IsPartOfWord: false })),
        { Text: ",", IsPartOfWord: true },
        ..."When you hold me tight".split(" ").map((Text) => ({ Text, IsPartOfWord: false })),
      ],
      "pronunciation",
      "vn",
      true
    ),
    "do isang gidêl gôsưn piryô opsso, When you hold me tight"
  );
});

test("Korean RR separators preserve lyric chunks", () => {
  assert.equal(
    romanizeKorean("어떻게든 날 감출 수 있게", "pronunciation", "rr", true),
    "eotteokedeun nal gamchul-ssu itkke"
  );
  assert.equal(
    romanizeKorean("나로 다시 돌아갈 수 있게", "pronunciation", "rr", true),
    "naro dasi doragal-ssu itkke"
  );
});

test("Korean RR and VN output styles remain distinct", () => {
  assert.equal(romanizeKorean("어떻게", "pronunciation", "rr"), "eotteoke");
  assert.equal(romanizeKorean("어떻게", "pronunciation", "vn"), "ottokê");
  assert.equal(romanizeKorean("한국어", "spelling", "rr"), "hangukeo");
  assert.equal(romanizeKorean("한국어", "spelling", "vn"), "hangugo");
});

test("Cyrillic corpus", () => {
  assert.equal(romanizeCyrillic("Елена"), "Yelena");
  assert.equal(romanizeCyrillic("Достоевский"), "Dostoyevskiy");
  assert.equal(romanizeCyrillic("Сергеевна"), "Sergeyevna");
  assert.equal(romanizeCyrillic("ё"), "yo");
  assert.equal(romanizeCyrillic("объект"), "obyekt");
  assert.equal(romanizeCyrillic("мягкий"), "myagkiy");
  assert.equal(romanizeCyrillic("Привет rock'n'roll"), "Privet rock'n'roll");
  assert.equal(romanizeCyrillic("гора", "Ukrainian", false), "hora");
  assert.equal(romanizeCyrillic("Київ", "Ukrainian", false), "Kyyiv");
  assert.equal(romanizeCyrillic("Україна", "Ukrainian", false), "Ukrayina");
  assert.equal(romanizeCyrillic("ґанок", "Ukrainian", false), "ganok");
  assert.equal(romanizeCyrillic("гора", "Russian", false), "gora");
  assert.equal(romanizeCyrillic("день", "Russian", false), "den");
  assert.equal(romanizeCyrillic("день", "Russian", true), "denʹ");
  assert.equal(romanizeCyrillic("объект", "Russian", true), "obʺyekt");
});

test("Cyrillic real-line corpus", () => {
  assert.equal(
    romanizeCyrillic("Я помню каждый миг, что было когда-то между нами,"),
    "Ya pomnyu kazhdyy mig, chto bylo kogda-to mezhdu nami,"
  );
  assert.equal(romanizeCyrillic("Ты, ты, ты, ты, ты, ты, ты, ты —"), "Ty, ty, ty, ty, ty, ty, ty, ty —");
  assert.equal(
    romanizeCyrillic("Ты, ты, ты, ты, ты, ты, ты, ты —"),
    romanizeCyrillic("Ты, ты, ты, ты, ты, ты, ты, ты —")
  );
  assert.equal(romanizeCyrillic("упрёков"), "upryokov");
  assert.equal(romanizeCyrillic("Чёрно-белый"), "Chyorno-belyy");
  assert.equal(romanizeCyrillic("Знаю — временно,"), "Znayu — vremenno,");
});

test("Central-Asian Cyrillic letters (Kyrgyz/Kazakh)", () => {
  assert.equal(romanizeCyrillic("Алдадыңбы"), "Aldadyngby");
  assert.equal(romanizeCyrillic("Чалбадыңбы"), "Chalbadyngby");
  assert.equal(romanizeCyrillic("Калбадыңбы жанымда"), "Kalbadyngby zhanymda");
  assert.equal(romanizeCyrillic("көңүл"), "kongul");
  assert.equal(romanizeCyrillic("Өмүр"), "Omur");
});

// Real-song Cantonese corpus: G.E.M. - Where Did U Go (traditional script, mixed English).
// See SpotifyPlus-mobilelyrics/docs/ROMANIZATION_REAL_CORPUS.md for the full categorized corpus.
test("Cantonese real-line corpus (Han-only lines)", async () => {
  assert.equal(await romanizeCantonese("難 藏 淚 印", "yue", true, true), "naan4 cong4 leoi6 jan3");
  assert.equal(
    await romanizeCantonese("這秒鐘 很掛牽 你 卻 不 可 感 覺 到", "yue", true, true),
    "ze5 miu5 zung1 han2 gwaa3 hin1 nei5 koek3 bat1 ho2 gam2 gok3 dou3"
  );
  // Pre-spaced source characters must not double-space the output.
  assert.equal(
    await romanizeCantonese("曾看著 同 星 空 閒 聊 吹 風", "yue", true, true),
    "cang4 hon3 zyu6 tung4 sing1 hung1 haan4 liu4 ceoi1 fung1"
  );
});

test("Cantonese mixed Latin lines keep English words intact", async () => {
  assert.equal(
    await romanizeCantonese("Where did you go 數數 多久 不 碰 到", "yue", true, true),
    "Where did you go sou2 sou3 do1 gau2 bat1 pung3 dou3"
  );
  assert.equal(
    await romanizeCantonese("Whoa, whoa 我在每 夜 徹 夜 狂 想", "yue", true, true),
    "Whoa, whoa ngo5 zoi6 mui5 je6 cit3 je6 kwong4 soeng2"
  );
});

test("Cantonese fullwidth punctuation real-line corpus", async () => {
  assert.equal(await romanizeCantonese("這秒鐘、很掛牽", "yue", true, true), "ze5 miu5 zung1 、 han2 gwaa3 hin1");
});

test("Cantonese polyphone gaps", async () => {
  assert.equal(await romanizeCantonese("看著電話中短訊", "yue", true, true), "hon3 zyu6 din6 waa6 zung1 dyun2 seon3");
});
