/** Portable jieba DAG+HMM segmenter from the cjk-labs shared Mandarin reader. */
export type ChineseTokenKind = "han" | "latin" | "digit" | "punctuation" | "whitespace" | "symbol" | "other";
export type MandarinSegmentToken = Readonly<{
  text: string;
  range: Readonly<{ start: number; end: number }>;
  kind: ChineseTokenKind;
  tag: string;
  subwords: readonly string[];
}>;
const count = (text: string) => Array.from(text).length;
const rows = (s: string) => s.split(/\r?\n/u).filter(Boolean).map((row) => row.split("\t"));
export function mandarinKind(value: string): ChineseTokenKind {
  if (/^\p{Script=Han}+$/u.test(value)) return "han";
  if (/^\p{Script=Latin}+$/u.test(value)) return "latin";
  if (/^\p{Number}+$/u.test(value)) return "digit";
  if (/^\p{Punctuation}+$/u.test(value)) return "punctuation";
  if (/^\p{White_Space}+$/u.test(value)) return "whitespace";
  if (/^\p{Symbol}+$/u.test(value)) return "symbol";
  return "other";
}


/** Portable jieba DAG+HMM segmentation supplies only sandhi feet and tags. */
export function createMandarinSegmenter(data: Readonly<{ jieba: string; hmm: string }>) {
  const dict = new Map<string, { frequency: number; tag: string }>();
  let total = 0, maxWord = 1;
  for (const [word, frequency, tag, ...extra] of rows(data.jieba)) {
    if (!word || !/^\d+$/u.test(frequency ?? "") || !tag || extra.length) throw new TypeError("Invalid jieba TSV.");
    total -= dict.get(word)?.frequency ?? 0;
    dict.set(word, { frequency: Number(frequency), tag }); total += Number(frequency); maxWord = Math.max(maxWord, count(word));
  }
  const hmm = JSON.parse(data.hmm) as { start: number[]; transition: number[][]; emission: Record<string, number>[] };
  if (hmm.start?.length !== 4 || hmm.transition?.length !== 4 || hmm.emission?.length !== 4
    || hmm.start.some((n) => !Number.isFinite(n)) || hmm.transition.some((row) => row.length !== 4 || row.some((n) => !Number.isFinite(n)))
    || hmm.emission.some((row) => !row || Object.entries(row).some(([c, n]) => count(c) !== 1 || !Number.isFinite(n)))) throw new TypeError("Invalid jieba HMM.");
  function hmmCut(points: readonly string[]): string[] {
    if (points.length < 2) return [...points];
    const allowed = [[1, 3], [0, 2], [2, 0], [3, 1]], minimum = -3.14e100;
    const scores = points.map(() => [0, 0, 0, 0]), previous = points.map(() => [0, 0, 0, 0]);
    for (let state = 0; state < 4; state++) scores[0]![state] = hmm.start[state]! + (hmm.emission[state]![points[0]!] ?? minimum);
    for (let at = 1; at < points.length; at++) for (let state = 0; state < 4; state++) {
      let best = -Infinity, from = 0;
      for (const candidate of allowed[state]!) {
        const value = scores[at - 1]![candidate]! + hmm.transition[candidate]![state]! + (hmm.emission[state]![points[at]!] ?? minimum);
        if (value >= best) { best = value; from = candidate; }
      }
      scores[at]![state] = best; previous[at]![state] = from;
    }
    const path = new Array<number>(points.length); let state = scores.at(-1)![1]! > scores.at(-1)![3]! ? 1 : 3;
    for (let at = points.length - 1; at >= 0; at--) { path[at] = state; state = previous[at]![state]!; }
    const out: string[] = []; let start = 0;
    path.forEach((state, at) => { if (state === 1 || state === 3) { out.push(points.slice(start, at + 1).join("")); start = at + 1; } });
    if (start < points.length) out.push(points.slice(start).join(""));
    return out;
  }
  const logTotal = Math.log(total);
  function segment(points: readonly string[]): string[] {
    const score = new Float64Array(points.length + 1), next = new Uint32Array(points.length);
    for (let start = points.length - 1; start >= 0; start--) {
      let best = -Infinity, stop = start + 1, found = false;
      for (let end = start + 1; end <= Math.min(points.length, start + maxWord); end++) {
        const record = dict.get(points.slice(start, end).join(""));
        if (!record) continue;
        found = true;
        const candidate = Math.log(record.frequency || 1) - logTotal + score[end]!;
        if (candidate >= best) { best = candidate; stop = end; }
      }
      score[start] = found ? best : -logTotal + score[start + 1]!; next[start] = stop;
    }
    const out: string[] = [];
    for (let i = 0; i < points.length;) { out.push(points.slice(i, next[i]!).join("")); i = next[i]!; }
    const grouped: string[] = []; let single: string[] = [];
    const flush = () => { const word = single.join(""); grouped.push(...(single.length > 1 && !dict.has(word) ? hmmCut(single) : single)); single = []; };
    for (const word of out) { if (count(word) === 1) single.push(word); else { flush(); grouped.push(word); } }
    flush(); return grouped;
  }
  if (!total) throw new TypeError("Incomplete Mandarin segmentation data.");
  return Object.freeze({ segment(text: string, normalized: string): readonly MandarinSegmentToken[] {
    const source = Array.from(text), shadow = Array.from(normalized);
    if (source.length !== shadow.length) throw new TypeError("Segmenter normalization must preserve code-point alignment.");
    const tokens: MandarinSegmentToken[] = [];
    for (let start = 0; start < source.length;) {
      const kind = mandarinKind(shadow[start]!); let end = start + 1;
      while (end < source.length && mandarinKind(shadow[end]!) === kind) end++;
      const surfaces = kind === "han" ? segment(shadow.slice(start, end)) : [shadow.slice(start, end).join("")];
      let offset = start;
      for (const surface of surfaces) {
        const size = count(surface), tag = kind === "han" ? dict.get(surface)?.tag ?? "x" : "x";
        const subwords: string[] = [];
        if (kind === "han") for (const width of [2, 3]) if (size > width) for (let i = 0; i + width <= size; i++) {
          if ((dict.get(Array.from(surface).slice(i, i + width).join(""))?.frequency ?? 0) > 0) subwords.push(source.slice(offset + i, offset + i + width).join(""));
        }
        tokens.push({ text: source.slice(offset, offset + size).join(""), range: { start: offset, end: offset + size }, kind, tag, subwords }); offset += size;
      }
      start = end;
    }
    return tokens;
  } });
}
