export type CjkReadingRunKind = "Han" | "Kana" | "Other";

export type CjkReadingRun = {
  kind: CjkReadingRunKind;
  text: string;
};

type ChineseDominantProcessors = {
  romanizeHan: (text: string) => string | undefined | Promise<string | undefined>;
  romanizeKana: (text: string) => string | undefined | Promise<string | undefined>;
};

const HanCharTest = /\p{Script=Han}/u;
const KanaCharTest = /\p{Script=Hiragana}|\p{Script=Katakana}/u;

function runKind(char: string): CjkReadingRunKind {
  if (HanCharTest.test(char)) return "Han";
  if (KanaCharTest.test(char)) return "Kana";
  return "Other";
}

export function partitionCjkReadingRuns(text: string): CjkReadingRun[] {
  const runs: CjkReadingRun[] = [];
  for (const char of Array.from(text.normalize("NFKC"))) {
    const kind = runKind(char);
    const previous = runs[runs.length - 1];
    if (kind === "Other" && previous) previous.text += char;
    else if (previous?.kind === kind) previous.text += char;
    else runs.push({ kind, text: char });
  }
  return runs;
}

export async function romanizeChineseDominantCjkText(
  text: string,
  processors: ChineseDominantProcessors
): Promise<string> {
  const runs = partitionCjkReadingRuns(text);
  let output = "";
  let previousKind: CjkReadingRunKind | undefined;

  for (const run of runs) {
    let transformed = run.text;
    if (run.kind === "Han") transformed = (await processors.romanizeHan(run.text)) || run.text;
    else if (run.kind === "Kana") transformed = (await processors.romanizeKana(run.text)) || run.text;

    const crossesReadableScriptBoundary =
      (previousKind === "Han" || previousKind === "Kana") &&
      (run.kind === "Han" || run.kind === "Kana") &&
      previousKind !== run.kind;
    if (crossesReadableScriptBoundary && output && !/\s$/u.test(output) && !/^\s/u.test(transformed)) {
      output += " ";
    }
    output += transformed;
    previousKind = run.kind;
  }

  return output;
}
