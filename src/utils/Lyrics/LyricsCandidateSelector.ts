import type { LyricsSelectionMode } from "./LyricsSourcePreferences.ts";

export type LyricsMatchMetadata = {
  title?: string;
  artists?: string[];
  album?: string;
  durationMs?: number;
  confidence?: number;
  method?: string;
};

export type LyricsCandidate = {
  provider: string;
  orderIndex: number;
  lyrics: any;
  match?: LyricsMatchMetadata;
};

export type LyricsCandidateAssessment = {
  provider: string;
  format: "Syllable" | "Line" | "Static" | "Unknown";
  selectionScore: number;
  trackMatchScore: number;
  timingScore: number;
  textAgreementScore: number;
  syncDetailScore: number;
  rejected: boolean;
  reasons: string[];
};

export type LyricsSelectionDiagnostics = {
  mode: LyricsSelectionMode;
  selectedProvider: string | null;
  candidates: LyricsCandidateAssessment[];
};

type LineView = { normalized: string; start?: number; end?: number };

function finite(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

export function normalizeLyricsComparisonText(value: unknown): string {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function lineViews(lyrics: any): LineView[] {
  if (lyrics?.Type === "Static") {
    return (lyrics.Lines ?? []).flatMap((line: any): LineView[] => {
      const normalized = normalizeLyricsComparisonText(line?.Text);
      return normalized ? [{ normalized }] : [];
    });
  }
  if (lyrics?.Type === "Line") {
    return (lyrics.Content ?? []).flatMap((line: any): LineView[] => {
      const normalized = normalizeLyricsComparisonText(line?.Text);
      return normalized ? [{ normalized, start: finite(line?.StartTime), end: finite(line?.EndTime) }] : [];
    });
  }
  if (lyrics?.Type === "Syllable") {
    return (lyrics.Content ?? []).flatMap((group: any): LineView[] => {
      const text = Array.isArray(group?.Lead?.Syllables)
        ? group.Lead.Syllables.map((syllable: any) => String(syllable?.Text ?? "")).join("")
        : "";
      const normalized = normalizeLyricsComparisonText(text);
      return normalized ? [{ normalized, start: finite(group?.Lead?.StartTime), end: finite(group?.Lead?.EndTime) }] : [];
    });
  }
  return [];
}

function bigrams(value: string): Map<string, number> {
  const points = Array.from(value);
  const counts = new Map<string, number>();
  if (points.length < 2) {
    if (value) counts.set(value, 1);
    return counts;
  }
  for (let index = 0; index < points.length - 1; index++) {
    const gram = points[index] + points[index + 1];
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

export function lyricsTextSimilarity(left: any, right: any): number {
  const leftText = lineViews(left).map((line) => line.normalized).join("");
  const rightText = lineViews(right).map((line) => line.normalized).join("");
  if (!leftText || !rightText) return 0;
  if (leftText === rightText) return 1;
  const leftGrams = bigrams(leftText);
  const rightGrams = bigrams(rightText);
  let leftCount = 0;
  let rightCount = 0;
  let shared = 0;
  for (const count of leftGrams.values()) leftCount += count;
  for (const count of rightGrams.values()) rightCount += count;
  for (const [gram, count] of leftGrams) shared += Math.min(count, rightGrams.get(gram) ?? 0);
  return leftCount + rightCount ? (2 * shared) / (leftCount + rightCount) : 0;
}

function trackScore(match?: LyricsMatchMetadata): number {
  if (Number.isFinite(match?.confidence)) return clamp(Number(match!.confidence) * 100);
  return 65;
}

function timingHealth(lyrics: any, durationMs: number): number {
  const lines = lineViews(lyrics);
  if (!lines.length) return 0;
  if (lyrics?.Type === "Static") return lines.length >= 3 ? 50 : 20;
  let faults = 0;
  let previous = -Infinity;
  for (const line of lines) {
    if (line.start === undefined || line.end === undefined || line.start < 0 || line.end < line.start) faults++;
    if (line.start !== undefined && line.start + 0.2 < previous) faults++;
    if (line.start !== undefined) previous = Math.max(previous, line.start);
  }
  let score = 100 - (faults / lines.length) * 75;
  const timed = lines.filter((line) => line.start !== undefined && line.end !== undefined);
  if (timed.length && durationMs > 0) {
    const last = Math.max(...timed.map((line) => line.end!));
    const durationSeconds = Math.max(1, durationMs / 1000);
    if (last < durationSeconds * 0.3) score -= 30;
    if (last > durationSeconds + 15) score -= Math.min(35, last - durationSeconds - 15);
  }
  if (lyrics?.Type === "Syllable") {
    let wordFaults = 0;
    let wordCount = 0;
    for (const group of lyrics.Content ?? []) {
      let wordStart = -Infinity;
      for (const word of group?.Lead?.Syllables ?? []) {
        wordCount++;
        const start = finite(word?.StartTime);
        const end = finite(word?.EndTime);
        if (start === undefined || end === undefined || end < start || start + 0.05 < wordStart) wordFaults++;
        if (start !== undefined) wordStart = Math.max(wordStart, start);
      }
    }
    if (wordCount < lines.length) score -= 25;
    if (wordCount) score -= (wordFaults / wordCount) * 80;
  }
  return clamp(score);
}

function agreementScore(candidate: LyricsCandidate, all: readonly LyricsCandidate[]): number {
  const peerScores = all.filter((peer) => peer !== candidate).map((peer) => lyricsTextSimilarity(candidate.lyrics, peer.lyrics));
  if (!peerScores.length) return 65;
  return clamp(Math.max(...peerScores) * 100);
}

function detailScore(lyrics: any): number {
  if (lyrics?.Type === "Syllable") return 100;
  if (lyrics?.Type === "Line") return 70;
  if (lyrics?.Type === "Static") return 20;
  return 0;
}

export function assessLyricsCandidates(candidates: readonly LyricsCandidate[], durationMs: number): LyricsCandidateAssessment[] {
  return candidates.map((candidate) => {
    const format = (["Syllable", "Line", "Static"] as string[]).includes(candidate.lyrics?.Type)
      ? candidate.lyrics.Type as LyricsCandidateAssessment["format"]
      : "Unknown";
    const track = trackScore(candidate.match);
    const timing = timingHealth(candidate.lyrics, durationMs);
    const agreement = agreementScore(candidate, candidates);
    const detail = detailScore(candidate.lyrics);
    const rejected = !lineViews(candidate.lyrics).length || detail === 0 || track < 25 || timing < 20;
    const staticPenalty = format === "Static" ? 15 : 0;
    const malformedSyllablePenalty = format === "Syllable" && timing < 80 ? 12 : 0;
    const selectionScore = rejected
      ? 0
      : clamp(track * 0.4 + timing * 0.3 + agreement * 0.2 + detail * 0.1 - staticPenalty - malformedSyllablePenalty);
    const reasons = [
      track >= 85 ? "strong track match" : track < 45 ? "weak track match" : "usable track match",
      format === "Static" ? "unsynced" : timing >= 80 ? "healthy timing" : "questionable timing",
      agreement >= 75 ? "agrees with another source" : agreement < 40 ? "low text agreement" : "limited comparison evidence",
    ];
    return {
      provider: candidate.provider,
      format,
      selectionScore: rounded(selectionScore),
      trackMatchScore: rounded(track),
      timingScore: rounded(timing),
      textAgreementScore: rounded(agreement),
      syncDetailScore: detail,
      rejected,
      reasons,
    };
  });
}

function formatRank(lyrics: any): number {
  return lyrics?.Type === "Syllable" ? 3 : lyrics?.Type === "Line" ? 2 : lyrics?.Type === "Static" ? 1 : 0;
}

export function selectLyricsCandidate(
  candidates: readonly LyricsCandidate[],
  durationMs: number,
  mode: LyricsSelectionMode,
): { candidate: LyricsCandidate | null; diagnostics: LyricsSelectionDiagnostics } {
  const ordered = [...candidates].sort((left, right) => left.orderIndex - right.orderIndex);
  const assessments = assessLyricsCandidates(ordered, durationMs);
  const assessmentByProvider = new Map(assessments.map((assessment) => [assessment.provider, assessment]));
  let candidate: LyricsCandidate | null = null;
  if (mode === "strict") {
    candidate = ordered.find((item) => !assessmentByProvider.get(item.provider)?.rejected) ?? null;
  } else if (mode === "syncType") {
    candidate = ordered
      .filter((item) => !assessmentByProvider.get(item.provider)?.rejected)
      .sort((left, right) => formatRank(right.lyrics) - formatRank(left.lyrics) || left.orderIndex - right.orderIndex)[0] ?? null;
  } else {
    candidate = ordered
      .filter((item) => !assessmentByProvider.get(item.provider)?.rejected)
      .sort((left, right) => {
        const difference = (assessmentByProvider.get(right.provider)?.selectionScore ?? 0)
          - (assessmentByProvider.get(left.provider)?.selectionScore ?? 0);
        return difference || left.orderIndex - right.orderIndex;
      })[0] ?? null;
  }
  return { candidate, diagnostics: { mode, selectedProvider: candidate?.provider ?? null, candidates: assessments } };
}
