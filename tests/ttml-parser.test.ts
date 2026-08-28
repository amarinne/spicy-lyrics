import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTTML } from "../src/utils/Lyrics/ttml/parser.ts";

const tt = (timing: string, body: string): string =>
  `<tt xmlns:itunes="http://itunes.apple.com/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" itunes:timing="${timing}"><body><div>${body}</div></body></tt>`;

test("static TTML decodes approved entities", () => {
  const parsed = parseTTML(tt("None", "<p>Hello &amp; world</p><p>Second</p>"));
  assert.deepEqual(parsed, { Type: "Static", Lines: [{ Text: "Hello & world" }, { Text: "Second" }] });
});

test("line TTML accepts clock and offset times", () => {
  const parsed = parseTTML(tt("Line", '<p begin="00:00:01.000" end="00:00:03.000">Hello</p><p begin="4s" end="6500ms">World</p>'));
  assert.equal(parsed?.Type, "Line");
  if (parsed?.Type !== "Line") return;
  assert.deepEqual(parsed.Content.map((line) => [line.Text, line.StartTime, line.EndTime]), [["Hello", 1, 3], ["World", 4, 6.5]]);
});

test("syllable TTML preserves authored span whitespace and boundaries", () => {
  const parsed = parseTTML(tt("Word", '<p begin="1s" end="3s"><span begin="1s" end="2s">Watch </span><span begin="2s" end="3s">this</span></p>'));
  assert.equal(parsed?.Type, "Syllable");
  if (parsed?.Type !== "Syllable") return;
  assert.deepEqual(parsed.Content[0].Lead.Syllables.map((span) => [span.Text, span.StartTime, span.EndTime]), [["Watch ", 1, 2], ["this", 2, 3]]);
});

test("background vocals and duet alignment remain structured", () => {
  const input = `<tt xmlns:itunes="http://itunes.apple.com/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" itunes:timing="Word"><head><metadata><ttm:agent xml:id="v1" type="person"/><ttm:agent xml:id="v2" type="person"/></metadata></head><body><div><p ttm:agent="v2" begin="1s" end="3s"><span begin="1s" end="2s">Lead</span><span ttm:role="x-bg"><span begin="1.5s" end="2.5s">Back</span></span></p></div></body></tt>`;
  const parsed = parseTTML(input);
  assert.equal(parsed?.Type, "Syllable");
  if (parsed?.Type !== "Syllable") return;
  assert.equal(parsed.Content[0].OppositeAligned, true);
  assert.equal(parsed.Content[0].Background?.[0]?.Syllables[0]?.Text, "Back");
});

test("empty malformed unsupported frame and tick timing fail safely", () => {
  assert.equal(parseTTML(""), null);
  assert.equal(parseTTML("<tt><body>"), null);
  assert.equal(parseTTML(tt("None", "<p>Hello</div>")), null);
  assert.equal(parseTTML(`${tt("None", "<p>Hello</p>")} trailing junk`), null);
  assert.equal(parseTTML(tt("Unknown", "<p>Hello</p>")), null);
  const frames = parseTTML(tt("Line", '<p begin="10f" end="20f">Frame</p>'));
  const ticks = parseTTML(tt("Line", '<p begin="10t" end="20t">Tick</p>'));
  const frameClock = parseTTML(
    tt("Line", '<p begin="00:01:02:15" end="00:01:03:00">Frame clock</p>')
  );
  const malformedClock = parseTTML(
    tt("Line", '<p begin="00:01oops" end="00:02oops">Bad clock</p>')
  );
  assert.equal(frames?.Type === "Line" ? frames.Content[0].StartTime : undefined, undefined);
  assert.equal(ticks?.Type === "Line" ? ticks.Content[0].StartTime : undefined, undefined);
  assert.equal(
    frameClock?.Type === "Line" ? frameClock.Content[0].StartTime : undefined,
    undefined
  );
  assert.equal(
    malformedClock?.Type === "Line" ? malformedClock.Content[0].StartTime : undefined,
    undefined
  );
});
