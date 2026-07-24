export function normalizedDisplayText(text: string | undefined | null): string {
  return (text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

export function isMeaningfullyDifferent(
  candidate: string | undefined | null,
  source: string | undefined | null
): boolean {
  const normalizedCandidate = normalizedDisplayText(candidate);
  if (!normalizedCandidate) return false;
  return normalizedCandidate !== normalizedDisplayText(source);
}
