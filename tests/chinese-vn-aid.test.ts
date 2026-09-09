import assert from "node:assert/strict";
import { test } from "node:test";
import { convertMandarinSyllableToVnAid } from "../src/utils/Lyrics/Fork/MandarinVnAid.ts";
import { convertJyutpingSyllableToVnAid } from "../src/utils/Lyrics/Fork/CantoneseVnAid.ts";
import {
  isJyutpingTranslitMode,
  isVnAidTranslitMode,
  joinMandarinReadingWords,
  pronunciationSystemForChineseMode,
  romanizeCantoneseVn,
  romanizeMandarinVn,
  toggleChineseTranslitLanguage,
} from "../src/utils/Lyrics/Fork/Romanization.ts";
import { buildChineseAttachedReadings } from "../src/utils/Lyrics/Processing/ChineseReadingSegments.ts";

test("Mandarin VN-aid tone marks on ma", () => {
  assert.equal(convertMandarinSyllableToVnAid("ma1"), "ma");
  assert.equal(convertMandarinSyllableToVnAid("ma2"), "má");
  assert.equal(convertMandarinSyllableToVnAid("ma3"), "mả");
  assert.equal(convertMandarinSyllableToVnAid("ma4"), "mà");
  assert.equal(convertMandarinSyllableToVnAid("ma0"), "mạ");
  assert.equal(convertMandarinSyllableToVnAid("ma3", false), "ma");
});

test("Mandarin VN-aid stop series uses ASCII apostrophe aspiration", () => {
  assert.equal(convertMandarinSyllableToVnAid("ba1"), "ba");
  assert.equal(convertMandarinSyllableToVnAid("pa4"), "p'à");
  assert.equal(convertMandarinSyllableToVnAid("da1"), "ta");
  assert.equal(convertMandarinSyllableToVnAid("ta4"), "t'à");
  assert.equal(convertMandarinSyllableToVnAid("tai4"), "t'ài");
  assert.equal(convertMandarinSyllableToVnAid("ting1"), "t'ing");
  assert.equal(convertMandarinSyllableToVnAid("ge1"), "kơ");
  assert.equal(convertMandarinSyllableToVnAid("ke1"), "k'ơ");
  assert.equal(convertMandarinSyllableToVnAid("kan4"), "k'àn");
  // The output mark is U+0027, never a curly quote; input Pinyin separator
  // apostrophes are not content and never reach the output.
  for (const rendered of ["p'à", "t'ài", "k'àn"]) {
    assert.ok(rendered.includes("'"));
    assert.ok(!rendered.includes("’") && !rendered.includes("‘"));
  }
  assert.equal(convertMandarinSyllableToVnAid("tai4").codePointAt(1), 0x27);
  // Affricates stay symmetric-free: z/ts and zh/ch keep their spellings.
  assert.equal(convertMandarinSyllableToVnAid("ca1"), "tsa");
  assert.equal(convertMandarinSyllableToVnAid("zha1"), "zha");
  assert.equal(convertMandarinSyllableToVnAid("cha1"), "cha");
  assert.equal(convertMandarinSyllableToVnAid("ji1"), "zi");
  assert.equal(convertMandarinSyllableToVnAid("qi1"), "chi");
  assert.equal(convertMandarinSyllableToVnAid("xi1"), "shi");
  assert.equal(convertMandarinSyllableToVnAid("ci2"), "tsứ");
  assert.equal(convertMandarinSyllableToVnAid("si4"), "sừ");
});

test("Mandarin VN-aid apical i maps to ư", () => {
  assert.equal(convertMandarinSyllableToVnAid("zi1"), "zư");
  assert.equal(convertMandarinSyllableToVnAid("zhi1"), "zhư");
  assert.equal(convertMandarinSyllableToVnAid("chi1"), "chư");
  assert.equal(convertMandarinSyllableToVnAid("shi2"), "shứ");
  assert.equal(convertMandarinSyllableToVnAid("ri4"), "rừ");
  // Genuine i stays i.
  assert.equal(convertMandarinSyllableToVnAid("bi1"), "bi");
  assert.equal(convertMandarinSyllableToVnAid("ni3"), "nỉ");
});

test("Mandarin VN-aid yu family replaces ü output", () => {
  assert.equal(convertMandarinSyllableToVnAid("ju1"), "zyu");
  assert.equal(convertMandarinSyllableToVnAid("jue4"), "zyuè");
  assert.equal(convertMandarinSyllableToVnAid("juan1"), "zyuen");
  assert.equal(convertMandarinSyllableToVnAid("jun1"), "zyun");
  assert.equal(convertMandarinSyllableToVnAid("qu2"), "chyú");
  assert.equal(convertMandarinSyllableToVnAid("que4"), "chyuè");
  assert.equal(convertMandarinSyllableToVnAid("quan2"), "chyuén");
  assert.equal(convertMandarinSyllableToVnAid("qun1"), "chyun");
  assert.equal(convertMandarinSyllableToVnAid("xu1"), "shyu");
  assert.equal(convertMandarinSyllableToVnAid("xue2"), "shyué");
  assert.equal(convertMandarinSyllableToVnAid("xuan3"), "shyuẻn");
  assert.equal(convertMandarinSyllableToVnAid("xun4"), "shyùn");
  assert.equal(convertMandarinSyllableToVnAid("nü3"), "nyủ");
  assert.equal(convertMandarinSyllableToVnAid("lü4"), "lyù");
  assert.equal(convertMandarinSyllableToVnAid("nüe4"), "nyuè");
  assert.equal(convertMandarinSyllableToVnAid("yu2"), "yú");
  assert.equal(convertMandarinSyllableToVnAid("yue4"), "yuè");
  assert.equal(convertMandarinSyllableToVnAid("yuan2"), "yuén");
  assert.equal(convertMandarinSyllableToVnAid("yun1"), "yun");
  // No ü remains anywhere in normal renderer output.
  for (const syllable of ["ju1", "que4", "xuan3", "nü3", "lü4", "yuan2", "yun1"]) {
    assert.ok(!convertMandarinSyllableToVnAid(syllable).includes("ü"), syllable);
  }
});

test("Mandarin VN-aid ê marks the closer vowel in ei/uei only", () => {
  assert.equal(convertMandarinSyllableToVnAid("fei1"), "fêi");
  assert.equal(convertMandarinSyllableToVnAid("fei2"), "fếi");
  assert.equal(convertMandarinSyllableToVnAid("fei3"), "fểi");
  assert.equal(convertMandarinSyllableToVnAid("fei4"), "fềi");
  assert.equal(convertMandarinSyllableToVnAid("mei3"), "mểi");
  assert.equal(convertMandarinSyllableToVnAid("dui4"), "tuềi");
  assert.equal(convertMandarinSyllableToVnAid("hui4"), "huềi");
  assert.equal(convertMandarinSyllableToVnAid("gui1"), "kuêi");
  assert.equal(convertMandarinSyllableToVnAid("kui2"), "k'uếi");
  assert.equal(convertMandarinSyllableToVnAid("wei4"), "wềi");
  // The opener e stays plain in ie/ian/yue/yuen environments.
  assert.equal(convertMandarinSyllableToVnAid("xie4"), "shiè");
  assert.equal(convertMandarinSyllableToVnAid("tian1"), "t'ien");
  assert.equal(convertMandarinSyllableToVnAid("yue4"), "yuè");
  assert.equal(convertMandarinSyllableToVnAid("yuan2"), "yuén");
});

test("Mandarin VN-aid remaining final rewrites", () => {
  assert.equal(convertMandarinSyllableToVnAid("de2"), "tớ");
  assert.equal(convertMandarinSyllableToVnAid("men2"), "mấn");
  assert.equal(convertMandarinSyllableToVnAid("sheng1"), "shâng");
  assert.equal(convertMandarinSyllableToVnAid("nian2"), "nién");
  assert.equal(convertMandarinSyllableToVnAid("yan1"), "yien");
  assert.equal(convertMandarinSyllableToVnAid("lun2"), "luấn");
  assert.equal(convertMandarinSyllableToVnAid("wen1"), "wuân");
  assert.equal(convertMandarinSyllableToVnAid("weng1"), "wuâng");
  assert.equal(convertMandarinSyllableToVnAid("liu2"), "lióu");
  assert.equal(convertMandarinSyllableToVnAid("bo1"), "buo");
  assert.equal(convertMandarinSyllableToVnAid("er2"), "ér");
  assert.equal(convertMandarinSyllableToVnAid("zhong1"), "zhong");
  // Familiar zero-initial forms stay (tone on the structural vowel).
  assert.equal(convertMandarinSyllableToVnAid("you3"), "yỏu");
  assert.equal(convertMandarinSyllableToVnAid("wo3"), "wỏ");
  // Non-Pinyin input passes through.
  assert.equal(convertMandarinSyllableToVnAid("Hello"), "Hello");
});

test("Mandarin VN-aid output is NFC", () => {
  const samples = ["nü3", "lü4", "quan2", "xuan3", "mei3", "kui2", "sheng1", "lun2"];
  for (const sample of samples) {
    const rendered = convertMandarinSyllableToVnAid(sample);
    assert.equal(rendered, rendered.normalize("NFC"), sample);
  }
});

test("Mandarin VN-aid contextual mergers stay distinct", () => {
  // ji/qi/xi (front families) vs zi/ci/si (apical) vs zhi/chi/shi (retroflex).
  assert.notEqual(convertMandarinSyllableToVnAid("ji1"), convertMandarinSyllableToVnAid("zi1"));
  assert.notEqual(convertMandarinSyllableToVnAid("qi1"), convertMandarinSyllableToVnAid("chi1"));
  assert.notEqual(convertMandarinSyllableToVnAid("xi1"), convertMandarinSyllableToVnAid("shi1"));
  assert.equal(convertMandarinSyllableToVnAid("ji1"), "zi");
  assert.equal(convertMandarinSyllableToVnAid("zi1"), "zư");
});

test("Mandarin VN-aid has no collisions across the covered syllable inventory", () => {
  const bases = [
    "ba", "pa", "ma", "fa", "da", "ta", "na", "la", "ga", "ka", "ha",
    "zha", "cha", "sha", "ra", "za", "ca", "sa", "jia", "qia", "xia",
    "ji", "qi", "xi", "zi", "ci", "si", "zhi", "chi", "shi", "ri",
    "bian", "pian", "mian", "tian", "nian", "lian", "jian", "qian", "xian", "zhan", "chan", "shan", "ran",
    "bin", "pin", "min", "nin", "lin", "jin", "qin", "xin", "zhen", "chen", "shen", "ren", "zen", "cen", "sen",
    "bing", "ping", "ming", "ting", "ning", "ling", "jing", "qing", "xing",
    "de", "te", "ne", "le", "ge", "ke", "he", "zhe", "che", "she", "re", "ze", "ce", "se",
    "fei", "mei", "nei", "lei",
    "diu", "liu", "niu", "jiu", "qiu", "xiu", "zhou", "chou", "shou", "rou", "zou", "cou", "sou",
    "dui", "tui", "gui", "kui", "hui", "zhui", "chui", "shui", "rui", "zui", "cui", "sui",
    "dun", "tun", "lun", "gun", "kun", "hun", "zhun", "chun", "shun", "run", "zun", "cun", "sun",
    "jun", "qun", "xun", "juan", "quan", "xuan", "jue", "que", "xue", "ju", "qu", "xu",
    "nü", "lü", "nüe", "lüe",
    "bo", "po", "mo", "fo", "duo", "tuo", "nuo", "luo", "guo", "kuo", "huo", "zhuo", "chuo", "shuo", "ruo", "zuo", "cuo", "suo",
    "dong", "tong", "nong", "long", "gong", "kong", "hong", "zhong", "chong", "rong", "zong", "cong", "song",
    "jiong", "qiong", "xiong", "er", "yan", "wen", "weng", "yuan", "yun", "yue", "yu", "yi", "yin", "ying", "yong", "you", "wei", "wo",
    "die", "tie", "nie", "lie", "jie", "qie", "xie",
  ];
  for (const tone of [1, 2, 3, 4, 0]) {
    const seen = new Map<string, string>();
    for (const base of bases) {
      const rendered = convertMandarinSyllableToVnAid(`${base}${tone}`);
      const clash = seen.get(rendered);
      assert.equal(clash, undefined, `${base}${tone} collides with ${clash} as ${rendered}`);
      seen.set(rendered, `${base}${tone}`);
    }
  }
});

test("Mandarin VN-aid lyric acceptance corpus", () => {
  assert.equal(romanizeMandarinVn("你好", true), "nỉ hảo");
  assert.equal(romanizeMandarinVn("你好", false), "ni hao");
  assert.equal(romanizeMandarinVn("音乐银行", true), "yin yuè yín háng");
  assert.equal(
    joinMandarinReadingWords("音乐 银行", romanizeMandarinVn("音乐 银行", true)),
    "yinyuè yínháng"
  );
  assert.equal(
    romanizeMandarinVn("算不算愛我不太確定", true),
    "suàn bù suàn ài wỏ bù t'ài chyuè tìng"
  );
  assert.equal(
    romanizeMandarinVn("看著窗外的小星星", true),
    "k'àn zhù chuang wài tợ shiảo shing shing"
  );
  assert.equal(
    romanizeMandarinVn("我想要唱給你聽", true),
    "wỏ shiảng yào chàng kểi nỉ t'ing"
  );
});

test("Cantonese VN-aid tone marks on saa", () => {
  assert.equal(convertJyutpingSyllableToVnAid("saa1"), "sã");
  assert.equal(convertJyutpingSyllableToVnAid("saa2"), "sá");
  assert.equal(convertJyutpingSyllableToVnAid("saa3"), "sa");
  assert.equal(convertJyutpingSyllableToVnAid("saa4"), "sà");
  assert.equal(convertJyutpingSyllableToVnAid("saa5"), "sả");
  assert.equal(convertJyutpingSyllableToVnAid("saa6"), "sạ");
  assert.equal(convertJyutpingSyllableToVnAid("saat3"), "sat");
  assert.equal(convertJyutpingSyllableToVnAid("sak6"), "sặc");
  assert.equal(convertJyutpingSyllableToVnAid("sa1"), "sẵ");
  // Entering labels fold to their 1/3/6 categories.
  assert.equal(convertJyutpingSyllableToVnAid("sat7"), "sẵt");
  assert.equal(convertJyutpingSyllableToVnAid("sat8"), "săt");
  assert.equal(convertJyutpingSyllableToVnAid("sat9"), "sặt");
});

test("Cantonese VN-aid onset mapping", () => {
  assert.equal(convertJyutpingSyllableToVnAid("dok6"), "tọc");
  assert.equal(convertJyutpingSyllableToVnAid("tok1"), "thõc");
  assert.equal(convertJyutpingSyllableToVnAid("gok1"), "kõc");
  assert.equal(convertJyutpingSyllableToVnAid("kok1"), "khõc");
  assert.equal(convertJyutpingSyllableToVnAid("gwong2"), "quóng");
  assert.equal(convertJyutpingSyllableToVnAid("kwaa1"), "khoã");
  assert.equal(convertJyutpingSyllableToVnAid("kwik1"), "khwĩc");
  assert.equal(convertJyutpingSyllableToVnAid("dei6"), "tẹi");
  // j + yu-family coalesces to a single y.
  assert.equal(convertJyutpingSyllableToVnAid("jyu6"), "yụ");
  assert.equal(convertJyutpingSyllableToVnAid("jyun6"), "yụn");
  assert.equal(convertJyutpingSyllableToVnAid("cyun1"), "tsyũn");
});

test("Cantonese VN-aid eo family renders ơ, oe family renders ơo", () => {
  assert.equal(convertJyutpingSyllableToVnAid("seoi2"), "sới");
  assert.equal(convertJyutpingSyllableToVnAid("neoi5"), "nởi");
  assert.equal(convertJyutpingSyllableToVnAid("ceon1"), "tsỡn");
  assert.equal(convertJyutpingSyllableToVnAid("seon3"), "sơn");
  assert.equal(convertJyutpingSyllableToVnAid("zeon6"), "zợn");
  assert.equal(convertJyutpingSyllableToVnAid("ceot1"), "tsỡt");
  assert.equal(convertJyutpingSyllableToVnAid("seoi6"), "sợi");
  assert.equal(convertJyutpingSyllableToVnAid("hoe1"), "hỡo");
  assert.equal(convertJyutpingSyllableToVnAid("hoe2"), "hớo");
  assert.equal(convertJyutpingSyllableToVnAid("hoe3"), "hơo");
  assert.equal(convertJyutpingSyllableToVnAid("hoe4"), "hờo");
  assert.equal(convertJyutpingSyllableToVnAid("hoe5"), "hởo");
  assert.equal(convertJyutpingSyllableToVnAid("hoe6"), "hợo");
  assert.equal(convertJyutpingSyllableToVnAid("soeng1"), "sỡong");
  assert.equal(convertJyutpingSyllableToVnAid("soeng2"), "sớong");
  assert.equal(convertJyutpingSyllableToVnAid("soet1"), "sỡot");
  assert.equal(convertJyutpingSyllableToVnAid("hoek3"), "hơoc");
  // The echo o never bears tone: only the first ơ is marked.
  assert.equal(convertJyutpingSyllableToVnAid("soe1"), "sỡo");
});

test("Cantonese VN-aid other finals unchanged", () => {
  assert.equal(convertJyutpingSyllableToVnAid("sek6"), "sẹc");
  assert.equal(convertJyutpingSyllableToVnAid("sik1"), "sĩc");
  assert.equal(convertJyutpingSyllableToVnAid("suk1"), "sũc");
  assert.equal(convertJyutpingSyllableToVnAid("seng1"), "sẽng");
  assert.equal(convertJyutpingSyllableToVnAid("nei5"), "nẻi");
  assert.equal(convertJyutpingSyllableToVnAid("hou2"), "hóu");
  // Rare eu/em/ep rows stay.
  assert.equal(convertJyutpingSyllableToVnAid("deu1"), "tẽu");
  assert.equal(convertJyutpingSyllableToVnAid("lem2"), "lém");
  assert.equal(convertJyutpingSyllableToVnAid("gep1"), "kẽp");
  // Syllabic nasals carry the mark themselves.
  assert.equal(convertJyutpingSyllableToVnAid("m4"), "m̀");
  assert.equal(convertJyutpingSyllableToVnAid("m6"), "ṃ");
  assert.equal(convertJyutpingSyllableToVnAid("ng5"), "n̉g");
  assert.equal(convertJyutpingSyllableToVnAid("hm4"), "hm̀");
  // Toneless input and garbage pass through without marks.
  assert.equal(convertJyutpingSyllableToVnAid("nei"), "nei");
  assert.equal(convertJyutpingSyllableToVnAid("xyz"), "xyz");
});

test("Cantonese VN-aid tone stripping keeps segmental spelling", () => {
  assert.equal(convertJyutpingSyllableToVnAid("sam1"), "sẵm");
  assert.equal(convertJyutpingSyllableToVnAid("sam1", false), "săm");
  assert.equal(convertJyutpingSyllableToVnAid("soeng2", false), "sơong");
  assert.equal(convertJyutpingSyllableToVnAid("seoi2", false), "sơi");
});

test("Cantonese VN-aid output is NFC", () => {
  const samples = ["seoi2", "ceon1", "soeng2", "hoek3", "sam1", "m4", "ng5", "hoe6", "kwaa1"];
  for (const sample of samples) {
    const rendered = convertJyutpingSyllableToVnAid(sample);
    assert.equal(rendered, rendered.normalize("NFC"), sample);
  }
});

test("Cantonese VN-aid tone never lands on qu-/kho- glides", () => {
  // qua1: mark the final a, not the onset u.
  assert.equal(convertJyutpingSyllableToVnAid("gwaa1"), "quã");
  assert.equal(convertJyutpingSyllableToVnAid("kwaa1"), "khoã");
  // yu-family: the final u IS the nucleus and takes the mark.
  assert.equal(convertJyutpingSyllableToVnAid("jyu6"), "yụ");
});

test("Cantonese VN-aid line rendering", async () => {
  assert.equal(await romanizeCantoneseVn("你好", "yue", true, true), "nẻi hóu");
  assert.equal(await romanizeCantoneseVn("你好", "yue", true, false), "nei hou");
  assert.equal(await romanizeCantoneseVn("香港", "yue", true, true), "hỡong kóng");
  assert.equal(
    await romanizeCantoneseVn("Where did you go 數數", "yue", true, true),
    "Where did you go sóu sou"
  );
});

test("Chinese translit mode helpers", () => {
  assert.equal(isJyutpingTranslitMode("pinyin"), false);
  assert.equal(isJyutpingTranslitMode("jyutping"), true);
  assert.equal(isJyutpingTranslitMode("pinyin-vn"), false);
  assert.equal(isJyutpingTranslitMode("jyutping-vn"), true);
  assert.equal(isVnAidTranslitMode("pinyin"), false);
  assert.equal(isVnAidTranslitMode("pinyin-vn"), true);
  assert.equal(isVnAidTranslitMode("jyutping-vn"), true);
  assert.equal(toggleChineseTranslitLanguage("pinyin"), "jyutping");
  assert.equal(toggleChineseTranslitLanguage("jyutping"), "pinyin");
  assert.equal(toggleChineseTranslitLanguage("pinyin-vn"), "jyutping-vn");
  assert.equal(toggleChineseTranslitLanguage("jyutping-vn"), "pinyin-vn");
  assert.equal(pronunciationSystemForChineseMode("pinyin"), "mandarin-pinyin");
  assert.equal(pronunciationSystemForChineseMode("jyutping"), "cantonese-jyutping");
  assert.equal(pronunciationSystemForChineseMode("pinyin-vn"), "mandarin-pinyin-vn");
  assert.equal(pronunciationSystemForChineseMode("jyutping-vn"), "cantonese-jyutping-vn");
});

test("Chinese VN-aid attached readings carry their own kind", () => {
  const spans = [
    { spanId: "0", canonicalRange: { startCp: 0, endCp: 1 } },
    { spanId: "1", canonicalRange: { startCp: 1, endCp: 2 } },
  ];
  const mandarin = buildChineseAttachedReadings("你好", "pinyin-vn", true, spans);
  assert.deepEqual(mandarin.map((r) => r.kind), ["mandarinVnAid", "mandarinVnAid"]);
  assert.deepEqual(mandarin.map((r) => r.reading), ["nỉ", "hảo"]);

  const cantonese = buildChineseAttachedReadings("你好", "jyutping-vn", true, spans);
  assert.deepEqual(cantonese.map((r) => r.kind), ["cantoneseVnAid", "cantoneseVnAid"]);
  assert.deepEqual(cantonese.map((r) => r.reading), ["nẻi", "hóu"]);

  const plain = buildChineseAttachedReadings("你好", "pinyin", true, spans);
  assert.deepEqual(plain.map((r) => r.kind), ["mandarinPinyin", "mandarinPinyin"]);
});
