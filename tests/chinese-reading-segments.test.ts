import assert from "node:assert/strict";
import { test } from "node:test";
import { buildChineseAttachedReadings } from "../src/utils/Lyrics/Processing/ChineseReadingSegments.ts";
import {
  buildLineAttachedPlan,
  buildTimedGenericPlan,
} from "../src/utils/Lyrics/Processing/GenericReadingProcessor.ts";
import type { CanonicalSpanMapping } from "../src/utils/Lyrics/Processing/Model.ts";

/** One span per code point, the Line-tier shape where nothing constrains grouping. */
function perCharacterSpans(text: string): CanonicalSpanMapping[] {
  return Array.from(text).map((_, index) => ({
    spanId: String(index),
    canonicalRange: { startCp: index, endCp: index + 1 },
  }));
}

/** Spans of the given code-point widths, the Syllable-tier shape where the provider set the groups. */
function spansOfWidths(widths: readonly number[]): CanonicalSpanMapping[] {
  let cursor = 0;
  return widths.map((width, index) => {
    const mapping = {
      spanId: String(index),
      canonicalRange: { startCp: cursor, endCp: cursor + width },
    };
    cursor += width;
    return mapping;
  });
}

const sliceOf = (text: string, range: { startCp: number; endCp: number }): string =>
  Array.from(text).slice(range.startCp, range.endCp).join("");

test("pinyin readings land on the characters they read", () => {
  const text = "我走在长街中";
  const segments = buildChineseAttachedReadings(text, "pinyin", true, perCharacterSpans(text));

  assert.ok(segments.length > 0, "expected pinyin segments");
  for (const segment of segments) {
    assert.equal(segment.kind, "mandarinPinyin");
    // The reading must describe exactly the characters under it, or the ruby lies about its base.
    assert.match(sliceOf(text, segment.canonicalRange), /^[一-鿿]+$/u);
    assert.ok(segment.reading.trim().length > 0);
  }
});

test("jyutping readings land on the characters they read", () => {
  const text = "我走在长街中";
  const segments = buildChineseAttachedReadings(text, "jyutping", true, perCharacterSpans(text));

  assert.ok(segments.length > 0, "expected jyutping segments");
  for (const segment of segments) {
    assert.equal(segment.kind, "cantoneseJyutping");
    assert.match(sliceOf(text, segment.canonicalRange), /^[一-鿿]+$/u);
  }
});

test("latin, digits, and punctuation get no reading", () => {
  const text = "我 love 你 123!";
  for (const mode of ["pinyin", "jyutping"] as const) {
    const segments = buildChineseAttachedReadings(text, mode, true, perCharacterSpans(text));
    for (const segment of segments) {
      assert.match(
        sliceOf(text, segment.canonicalRange),
        /^[一-鿿]+$/u,
        `${mode} annotated a non-Han run`
      );
    }
    assert.ok(segments.length > 0, `${mode} should still annotate the Han characters`);
  }
});

test("segments never overlap and stay in source order", () => {
  const text = "一梦红尘几多愁";
  for (const mode of ["pinyin", "jyutping"] as const) {
    const segments = buildChineseAttachedReadings(text, mode, true, perCharacterSpans(text));
    let previousEnd = -1;
    for (const segment of segments) {
      assert.ok(
        segment.canonicalRange.startCp >= previousEnd,
        `${mode} produced overlapping or unordered segments`
      );
      previousEnd = segment.canonicalRange.endCp;
    }
  }
});

test("a reading names every span it covers", () => {
  const text = "一梦红尘";
  const spans = perCharacterSpans(text);
  for (const mode of ["pinyin", "jyutping"] as const) {
    for (const segment of buildChineseAttachedReadings(text, mode, true, spans)) {
      const covered = spans.filter((span) =>
        span.canonicalRange.startCp >= segment.canonicalRange.startCp &&
        span.canonicalRange.endCp <= segment.canonicalRange.endCp
      );
      assert.deepEqual(
        segment.spanIds,
        covered.map((span) => span.spanId),
        `${mode} segment span ids disagree with the range`
      );
    }
  }
});

test("a reading that would split a span is dropped, not reshaped", () => {
  const text = "一梦红尘";
  // One span owning all four characters: no per-character reading can be expressed against it
  // without splitting the span's timing, so nothing may be emitted.
  const wholeLineSpan = spansOfWidths([4]);
  for (const mode of ["pinyin", "jyutping"] as const) {
    const segments = buildChineseAttachedReadings(text, mode, true, wholeLineSpan);
    for (const segment of segments) {
      assert.equal(
        segment.canonicalRange.startCp, 0,
        `${mode} emitted a reading that starts mid-span`
      );
      assert.equal(
        segment.canonicalRange.endCp, 4,
        `${mode} emitted a reading that ends mid-span`
      );
    }
  }
});

test("turning tones off changes the reading, not the ranges", () => {
  const text = "一梦红尘";
  for (const mode of ["pinyin", "jyutping"] as const) {
    const spans = perCharacterSpans(text);
    const toned = buildChineseAttachedReadings(text, mode, true, spans);
    const plain = buildChineseAttachedReadings(text, mode, false, spans);
    assert.deepEqual(
      plain.map((segment) => segment.canonicalRange),
      toned.map((segment) => segment.canonicalRange),
      `${mode} ranges shifted when tones were disabled`
    );
  }
});

test("characters outside the BMP do not shift later ranges", () => {
  // A non-BMP character is two UTF-16 units but one code point. Ranges are code points, so a
  // reading after it must not drift by one.
  const text = "𠮷我";
  const spans = perCharacterSpans(text);
  assert.equal(spans.length, 2, "expected two code points");

  for (const mode of ["pinyin", "jyutping"] as const) {
    for (const segment of buildChineseAttachedReadings(text, mode, true, spans)) {
      assert.equal(
        sliceOf(text, segment.canonicalRange).length > 0, true,
        `${mode} produced an empty slice`
      );
      assert.ok(
        segment.canonicalRange.endCp <= 2,
        `${mode} produced a range past the end of the line`
      );
    }
  }
});

test("no spans means no attached readings", () => {
  assert.deepEqual(buildChineseAttachedReadings("一梦红尘", "pinyin", true, []), []);
  assert.deepEqual(buildChineseAttachedReadings("   ", "pinyin", true, perCharacterSpans("   ")), []);
});

test("the line-tier plan carries readings only when they can be built", () => {
  const chinese = buildLineAttachedPlan("一梦红尘", "yī mèng hóng chén", "line-0", "pinyin", true);
  assert.ok(chinese?.attachedReadings?.length, "expected attached readings on a Chinese line");
  assert.equal(chinese.readingUnits.length, 1, "the line keeps one reading unit for its joined text");

  // No Han, nothing to attach — the caller falls back to the line-level plan.
  assert.equal(buildLineAttachedPlan("hello there", "hello there", "line-1", "pinyin", true), undefined);
  assert.equal(buildLineAttachedPlan("", "", "line-2", "pinyin", true), undefined);
});

test("the syllable-tier plan attaches readings without disturbing timing", () => {
  const group = {
    StartTime: 0,
    EndTime: 1000,
    Syllables: Array.from("一梦红尘").map((character, index) => ({
      Text: character,
      StartTime: index * 250,
      EndTime: (index + 1) * 250,
      IsPartOfWord: false,
      RomanizedText: "",
    })),
  };
  const plain = buildTimedGenericPlan(group, "yī mèng hóng chén", "Chinese", {});
  const attached = buildTimedGenericPlan(group, "yī mèng hóng chén", "Chinese", {
    attachedReadings: { translitMode: "pinyin", tones: true },
  });

  assert.ok(attached?.attachedReadings?.length, "expected attached readings");
  assert.equal(plain?.attachedReadings, undefined, "plain plans stay free of attached readings");
  // The whole point of the span-ownership rule: placement must not move timing.
  assert.deepEqual(attached.timedReadingUnits, plain?.timedReadingUnits);
  assert.equal(attached.joinedDisplayText, plain?.joinedDisplayText);
});
