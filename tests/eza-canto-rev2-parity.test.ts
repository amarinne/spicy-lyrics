import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { convertJyutpingSyllableToVnAid } from "../src/utils/Lyrics/Fork/CantoneseVnAid.ts";
import { romanizeCantonese, romanizeCantoneseVn } from "../src/utils/Lyrics/Fork/Romanization.ts";
import { convertChineseText } from "../src/utils/Lyrics/ChineseCharacterConversion.ts";

// Cross-app parity corpus for Cantonese eza式 revision 2:
// cjk-labs `tests/fixtures/eza-canto-rev2-parity.json` at d6977ff, checked there by
// `tests/eza-canto-rev2-parity.test.ts`. Copying it keeps this test offline and pinned; the line
// rows are exact for to-jyutping clients, which both apps use.
type Case = Readonly<{ origin: string; source: string; jyutping: string; eza: string }>;
const fixture = JSON.parse(readFileSync(
  new URL("./fixtures/eza-canto-rev2-parity.json", import.meta.url),
  "utf8",
)) as Readonly<{
  schema: string;
  policy: string;
  syllables: readonly Readonly<{ jyutping: string; eza: string }>[];
  cases: readonly Case[];
}>;

test("Cantonese revision 2 syllable rows match the aid converter", () => {
  assert.equal(fixture.schema, "cjk-labs.eza-canto-rev2-parity.v1");
  const differences: unknown[] = [];
  for (const row of fixture.syllables) {
    const actual = convertJyutpingSyllableToVnAid(row.jyutping);
    if (actual !== row.eza) differences.push({ expected: row, actual });
  }
  assert.deepEqual(differences, []);
});

test("Cantonese revision 2 line rows match Jyutping and eza式", async () => {
  const differences: unknown[] = [];
  for (const row of fixture.cases) {
    const jyutping = await romanizeCantonese(row.source, "yue", true, true);
    const eza = await romanizeCantoneseVn(row.source, "yue", true, true);
    if (jyutping !== row.jyutping || eza !== row.eza) {
      differences.push({ row, actual: { jyutping, eza } });
    }
  }
  assert.deepEqual(differences, []);
});

test("R1 keeps reading the source when display text is converted", async () => {
  // ProcessLyrics converts the display characters before romanizing. The fifth argument carries the
  // provider's text, so simplified display (离/听/钱) must not replace the source evidence.
  const differences: unknown[] = [];
  for (const row of fixture.cases) {
    const display = convertChineseText(row.source, "simplified");
    const jyutping = await romanizeCantonese(display, "yue", true, true, row.source);
    const eza = await romanizeCantoneseVn(display, "yue", true, true, row.source);
    if (jyutping !== row.jyutping || eza !== row.eza) {
      differences.push({ row, display, actual: { jyutping, eza } });
    }
  }
  assert.deepEqual(differences, []);
});

test("R1 character-preserving cn→t lookup fixes simplified defaults", async () => {
  assert.equal(await romanizeCantonese("离", "yue", true, true), "lei4");
  assert.equal(await romanizeCantonese("听", "yue", true, true), "teng1");
  assert.equal(await romanizeCantonese("钱", "yue", true, true), "cin2");
  // A passage with traditional-only characters is already the lookup form.
  assert.equal(await romanizeCantonese("離", "yue", true, true), "lei4");
});
