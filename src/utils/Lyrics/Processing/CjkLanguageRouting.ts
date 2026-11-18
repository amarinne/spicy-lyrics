import { isHanYiAliasAfter } from "../Fork/MandarinZhuyin.ts";

export type CjkReadingRunKind = "Han" | "Kana" | "Zhuyin" | "Other";

export type CjkReadingRun = {
  kind: CjkReadingRunKind;
  text: string;
};

type ChineseDominantProcessors = {
  romanizeHan: (text: string, sourceText: string) => string | undefined | Promise<string | undefined>;
  romanizeKana: (text: string) => string | undefined | Promise<string | undefined>;
  romanizeZhuyin?: (text: string, sourceText: string) => string | undefined | Promise<string | undefined>;
};

const HanCharTest = /\p{Script=Han}/u;
const KanaCharTest = /\p{Script=Hiragana}|\p{Script=Katakana}/u;
const ZhuyinCharTest = /[\u3100-\u312f\u31a0-\u31bfˉˊˇˋ˙]/u;

function runKind(char: string): CjkReadingRunKind {
  if (HanCharTest.test(char)) return "Han";
  if (KanaCharTest.test(char)) return "Kana";
  if (ZhuyinCharTest.test(char)) return "Zhuyin";
  return "Other";
}

export function partitionCjkReadingRuns(text: string): CjkReadingRun[] {
  const runs: CjkReadingRun[] = [];
  const chars = Array.from(text.normalize("NFKC"));
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index]!;
    // A Han 一 immediately after a licensed Bopomofo initial is the authored ㄧ medial. Keeping
    // it in the Zhuyin run means the resolver sees the complete syllable (ㄒ一), never ㄒ + yi.
    const kind = char === "一" && index > 0 && isHanYiAliasAfter(chars[index - 1]!) ? "Zhuyin" : runKind(char);
    const previous = runs[runs.length - 1];
    if (kind === "Other" && previous) previous.text += char;
    else if (previous?.kind === kind) previous.text += char;
    else runs.push({ kind, text: char });
  }
  return runs;
}

export async function romanizeChineseDominantCjkText(
  text: string,
  processors: ChineseDominantProcessors,
  sourceText = text
): Promise<string> {
  const runs = partitionCjkReadingRuns(text);
  // A display character-form conversion is character-preserving, so the source partitions the same
  // way. When it does not, the source argument cannot be trusted positionally and each Han run is
  // its own lookup text.
  const sourceRuns = partitionCjkReadingRuns(sourceText);
  const sourceAligned = sourceRuns.length === runs.length
    && sourceRuns.every((run, index) => run.kind === runs[index].kind);
  let output = "";
  let previousKind: CjkReadingRunKind | undefined;

  for (const [index, run] of runs.entries()) {
    let transformed = run.text;
    if (run.kind === "Han") {
      transformed = (await processors.romanizeHan(run.text, sourceAligned ? sourceRuns[index].text : run.text)) || run.text;
    } else if (run.kind === "Kana") {
      transformed = (await processors.romanizeKana(run.text)) || run.text;
    } else if (run.kind === "Zhuyin") {
      transformed = (await processors.romanizeZhuyin?.(run.text, sourceAligned ? sourceRuns[index].text : run.text)) || run.text;
    }

    const readable = run.kind === "Han" || run.kind === "Kana" || run.kind === "Zhuyin";
    const previousReadable = previousKind === "Han" || previousKind === "Kana" || previousKind === "Zhuyin";
    const crossesReadableScriptBoundary = previousReadable && readable && previousKind !== run.kind;
    if (crossesReadableScriptBoundary && output && !/\s$/u.test(output) && !/^\s/u.test(transformed)) {
      output += " ";
    }
    output += transformed;
    previousKind = run.kind;
  }

  return output;
}
