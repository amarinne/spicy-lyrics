import assert from "node:assert/strict";
import { test } from "node:test";
import {
  convertThaiIpaLineToVnAid,
  convertThaiIpaSyllableToVnAid,
} from "../src/utils/Lyrics/Fork/ThaiVnAid.ts";

test("Thai VN-aid five tones on long aa", () => {
  assert.equal(convertThaiIpaSyllableToVnAid("maː˧"), "maa");
  assert.equal(convertThaiIpaSyllableToVnAid("/maː˨˩/"), "màa");
  assert.equal(convertThaiIpaSyllableToVnAid("maː˥˩"), "mãa");
  assert.equal(convertThaiIpaSyllableToVnAid("maː˦˥"), "máa");
  assert.equal(convertThaiIpaSyllableToVnAid("maː˩˩˦"), "mảa");
  // Tone suppression leaves the segmental spelling alone.
  assert.equal(convertThaiIpaSyllableToVnAid("maː˥˩", false), "maa");
});

test("Thai VN-aid monophthong quality and length", () => {
  assert.equal(convertThaiIpaSyllableToVnAid("mi˧"), "mi");
  assert.equal(convertThaiIpaSyllableToVnAid("miː˧"), "mii");
  assert.equal(convertThaiIpaSyllableToVnAid("mɯ˧"), "mư");
  assert.equal(convertThaiIpaSyllableToVnAid("mɯː˧"), "mưu");
  assert.equal(convertThaiIpaSyllableToVnAid("mu˧"), "mu");
  assert.equal(convertThaiIpaSyllableToVnAid("muː˧"), "muu");
  assert.equal(convertThaiIpaSyllableToVnAid("me˧"), "mê");
  assert.equal(convertThaiIpaSyllableToVnAid("meː˧"), "mêe");
  assert.equal(convertThaiIpaSyllableToVnAid("mɤ˧"), "mơ");
  assert.equal(convertThaiIpaSyllableToVnAid("mɤː˧"), "mơo");
  assert.equal(convertThaiIpaSyllableToVnAid("mo˧"), "mô");
  assert.equal(convertThaiIpaSyllableToVnAid("moː˧"), "môo");
  assert.equal(convertThaiIpaSyllableToVnAid("mɛ˧"), "me");
  assert.equal(convertThaiIpaSyllableToVnAid("mɛː˧"), "mee");
  assert.equal(convertThaiIpaSyllableToVnAid("ma˧"), "ma");
  assert.equal(convertThaiIpaSyllableToVnAid("maː˧"), "maa");
  assert.equal(convertThaiIpaSyllableToVnAid("mɔ˧"), "mo");
  assert.equal(convertThaiIpaSyllableToVnAid("mɔː˧"), "moo");
});

test("Thai VN-aid tone sits on the first vowel of long nuclei", () => {
  assert.equal(convertThaiIpaSyllableToVnAid("mɤː˨˩"), "mờo");
  assert.equal(convertThaiIpaSyllableToVnAid("mɤː˥˩"), "mỡo");
  assert.equal(convertThaiIpaSyllableToVnAid("mɤː˦˥"), "mớo");
  assert.equal(convertThaiIpaSyllableToVnAid("mɤː˩˩˦"), "mởo");
  assert.equal(convertThaiIpaSyllableToVnAid("mɯː˦˥"), "mứu");
  assert.equal(convertThaiIpaSyllableToVnAid("meː˩˩˦"), "mểe");
  assert.equal(convertThaiIpaSyllableToVnAid("moː˨˩"), "mồo");
});

test("Thai VN-aid consonants keep genuine values and merge ch", () => {
  assert.equal(convertThaiIpaSyllableToVnAid("ba˧"), "ba");
  assert.equal(convertThaiIpaSyllableToVnAid("pa˧"), "pa");
  assert.equal(convertThaiIpaSyllableToVnAid("pʰa˧"), "pha");
  assert.equal(convertThaiIpaSyllableToVnAid("da˧"), "da");
  assert.equal(convertThaiIpaSyllableToVnAid("ta˧"), "ta");
  assert.equal(convertThaiIpaSyllableToVnAid("tʰa˧"), "tha");
  assert.equal(convertThaiIpaSyllableToVnAid("ka˧"), "ka");
  assert.equal(convertThaiIpaSyllableToVnAid("kʰa˧"), "kha");
  assert.equal(convertThaiIpaSyllableToVnAid("tɕa˧"), "cha");
  assert.equal(convertThaiIpaSyllableToVnAid("tɕʰa˧"), "cha");
  assert.equal(convertThaiIpaSyllableToVnAid("tɕʰa˥˩"), "chã");
  assert.equal(convertThaiIpaSyllableToVnAid("ma˧"), "ma");
  assert.equal(convertThaiIpaSyllableToVnAid("na˧"), "na");
  assert.equal(convertThaiIpaSyllableToVnAid("ŋa˧"), "nga");
  assert.equal(convertThaiIpaSyllableToVnAid("fa˧"), "fa");
  assert.equal(convertThaiIpaSyllableToVnAid("sa˧"), "sa");
  assert.equal(convertThaiIpaSyllableToVnAid("ha˧"), "ha");
  assert.equal(convertThaiIpaSyllableToVnAid("ra˧"), "ra");
  assert.equal(convertThaiIpaSyllableToVnAid("la˧"), "la");
  assert.equal(convertThaiIpaSyllableToVnAid("wa˧"), "wa");
  assert.equal(convertThaiIpaSyllableToVnAid("ja˧"), "ya");
});

test("Thai VN-aid surface codas", () => {
  assert.equal(convertThaiIpaSyllableToVnAid("man˧"), "man");
  assert.equal(convertThaiIpaSyllableToVnAid("maŋ˧"), "mang");
  assert.equal(convertThaiIpaSyllableToVnAid("map˥˩"), "mãp");
  assert.equal(convertThaiIpaSyllableToVnAid("mat˨˩"), "màt");
  assert.equal(convertThaiIpaSyllableToVnAid("mak˥˩"), "mãk");
  assert.equal(convertThaiIpaSyllableToVnAid("maj˧"), "may");
  assert.equal(convertThaiIpaSyllableToVnAid("maw˧"), "maw");
  // Thai keeps final -k (no Cantonese -c import).
  assert.ok(convertThaiIpaSyllableToVnAid("mak˥˩").endsWith("k"));
});

test("Thai VN-aid diphthongs and tone on the first element", () => {
  assert.equal(convertThaiIpaSyllableToVnAid("mia˧"), "mia");
  assert.equal(convertThaiIpaSyllableToVnAid("mia˩˩˦"), "mỉa");
  assert.equal(convertThaiIpaSyllableToVnAid("mɯa˧"), "mưa");
  assert.equal(convertThaiIpaSyllableToVnAid("mua˧"), "mua");
  assert.equal(convertThaiIpaSyllableToVnAid("miːa˧"), "miia");
  assert.equal(convertThaiIpaSyllableToVnAid("muːa˥˩"), "mũua");
});

test("Thai VN-aid clusters render compositionally", () => {
  assert.equal(convertThaiIpaSyllableToVnAid("kʰruː˩˩˦"), "khrủu");
  assert.equal(convertThaiIpaSyllableToVnAid("kra˧"), "kra");
});

test("Thai VN-aid refuses to guess on unknown contours", () => {
  assert.equal(convertThaiIpaSyllableToVnAid("ma˥˦"), "ma˥˦");
  assert.equal(convertThaiIpaSyllableToVnAid("xyz"), "xyz");
  assert.equal(convertThaiIpaSyllableToVnAid(""), "");
});

test("Thai VN-aid line splitter converts syllable by syllable", () => {
  assert.equal(convertThaiIpaLineToVnAid("maː˧ maː˥˩"), "maa mãa");
  assert.equal(convertThaiIpaLineToVnAid("mɤː˧·kʰruː˩˩˦"), "mơo khrủu");
});

test("Thai VN-aid output is NFC", () => {
  const samples = ["mɤː˥˩", "mɯː˦˥", "meː˩˩˦", "moː˨˩", "kʰruː˩˩˦", "muːa˥˩"];
  for (const sample of samples) {
    const rendered = convertThaiIpaSyllableToVnAid(sample);
    assert.equal(rendered, rendered.normalize("NFC"), sample);
  }
});
