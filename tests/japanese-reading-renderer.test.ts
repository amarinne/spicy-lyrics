import assert from "node:assert/strict";
import { test } from "node:test";

class FakeClassList {
  readonly values = new Set<string>();

  add(...names: string[]): void {
    names.forEach((name) => this.values.add(name));
  }

  toggle(name: string, force?: boolean): void {
    if (force === false) this.values.delete(name);
    else this.values.add(name);
  }
}

class FakeElement {
  className = "";
  classList = new FakeClassList();
  children: FakeElement[] = [];
  dataset: Record<string, string> = {};
  style = { marginLeft: "" };
  textContent = "";

  get childElementCount(): number {
    return this.children.length;
  }

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }
}

const storage = new Map<string, string>();
(globalThis as any).window = globalThis;
(globalThis as any).Spicetify = {
  LocalStorage: {
    get: (key: string) => storage.get(key) ?? null,
    set: (key: string, value: string) => storage.set(key, value),
  },
};
(globalThis as any).document = {
  querySelector: () => null,
  createElement: () => new FakeElement(),
};
(globalThis as any).MutationObserver = class {
  observe(): void {}
  disconnect(): void {}
};

const { appendSyllableRomanizedBelow, hasFuriganaCrossingTimedUnits } = await import(
  "../src/utils/Lyrics/Applyer/ReadingRenderer.ts"
);
const { renderExperimentalReadingPlan } = await import(
  "../src/utils/Lyrics/Applyer/ExperimentalReadingPlanRenderer.ts"
);
const { $adaptiveSectioning } = await import("../src/utils/stores.ts");
const { $japaneseReadingMode } = await import("../src/utils/uiState.ts");

const plan = {
  lineId: "jp",
  sourceUnits: [],
  readingUnits: [],
  timedReadingUnits: [{
    spanId: "0",
    canonicalRange: { startCp: 0, endCp: 1 },
    text: "watashi",
    logicalGroupId: "jp-0",
  }],
  joinedDisplayText: "watashi",
};

function render(mode: "romaji" | "furigana" | "both"): FakeElement {
  $adaptiveSectioning.set(true);
  $japaneseReadingMode.set(mode);
  const line = new FakeElement();
  appendSyllableRomanizedBelow(
    line as unknown as HTMLElement,
    [{ Text: "私", JapaneseReading: { sourceText: "私", romaji: "watashi", furigana: [] } }],
    "私",
    "watashi",
    "I",
    [{}],
    plan,
    { useRomanized: true, isJapaneseLyrics: true }
  );
  return line;
}

test("plan romaji follows Japanese reading display mode", () => {
  const furigana = render("furigana");
  assert.equal(furigana.children.some((child) => child.className.includes("reading-plan-row")), false);
  assert.equal(furigana.children.some((child) => child.className.includes("translated-below")), true);

  for (const mode of ["romaji", "both"] as const) {
    const line = render(mode);
    const readingRow = line.children.find((child) => child.className.includes("reading-plan-row"));
    assert.ok(readingRow, mode);
    assert.equal(readingRow.children[0]?.className, "reading-plan-group", mode);
    assert.equal(line.children.some((child) => child.className.includes("translated-below")), true, mode);
  }
});

test("adaptive sectioning off removes layout groups but preserves timed targets", () => {
  assert.equal($adaptiveSectioning.get(), true);
  $adaptiveSectioning.set(false);
  const parent = new FakeElement();
  const bound: Array<[string, FakeElement]> = [];
  const row = renderExperimentalReadingPlan(
    parent as unknown as HTMLElement,
    {
      ...plan,
      timedReadingUnits: [
        { ...plan.timedReadingUnits[0], text: "watashi", logicalGroupId: "jp-0" },
        {
          spanId: "1",
          canonicalRange: { startCp: 1, endCp: 2 },
          text: " no",
          logicalGroupId: "jp-1",
        },
      ],
    },
    (spanId, element) => bound.push([spanId, element as unknown as FakeElement])
  ) as unknown as FakeElement;

  assert.deepEqual(row.children.map((child) => child.className), [
    "romanized-syllable reading-plan-timed-unit",
    "romanized-syllable reading-plan-timed-unit",
  ]);
  assert.equal(row.children[1].textContent, "no");
  assert.equal(row.children[1].style.marginLeft, "0.25em");
  assert.deepEqual(bound.map(([spanId, element]) => [spanId, element.dataset.spanId]), [
    ["0", "0"],
    ["1", "1"],
  ]);
  $adaptiveSectioning.set(true);
});

test("cross-fragment compound ruby requires whole-line rendering", () => {
  const planWithSplitCompound = {
    ...plan,
    sourceUnits: [
      { spanId: "0", canonicalRange: { startCp: 0, endCp: 1 } },
      { spanId: "1", canonicalRange: { startCp: 1, endCp: 4 } },
    ],
    furigana: [{ start: 0, end: 2, reading: "おぼつか" }],
  };
  assert.equal(hasFuriganaCrossingTimedUnits(planWithSplitCompound), true);
  assert.equal(hasFuriganaCrossingTimedUnits({ ...planWithSplitCompound, sourceUnits: [{ spanId: "0", canonicalRange: { startCp: 0, endCp: 4 } }] }), false);
});
