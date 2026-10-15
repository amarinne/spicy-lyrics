import { resolveLyricsSourceLabel } from "../../LyricsSourcePreferences.ts";

export function ApplyLyricsProvider(data: any, LyricsContainer: HTMLElement): void {
  if (!data?.source || !LyricsContainer) return;

  // Plain credit line: the fork fetches from the Spicy Lyrics service only, so
  // there is no source for the reader to switch to.
  const ProviderElement = document.createElement("div");
  ProviderElement.classList.add("LyricsProvider");
  const providerLabel = resolveLyricsSourceLabel(data.source, data.sourceDisplayName, data.fetchProvider) ?? "Unknown";
  ProviderElement.textContent = `Source: ${providerLabel}`;
  LyricsContainer.appendChild(ProviderElement);
}