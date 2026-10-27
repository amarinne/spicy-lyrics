import { resolveLyricsSourceLabel } from "../../LyricsSourcePreferences.ts";
import { CreditsRow } from "./CreditsRow.ts";

const ProviderMap = {
    "spt": "Spotify",
    "aml": "Apple Music",
    "spl": "Spicy Lyrics",
    "ldb": "Local DB",
    "uns": "Unison",
} as const;

// `url` carries a utm_source so the source can tell visits that came from here.
const ViaMap: Record<string, { label: string; url?: string }> = {
  "lrc-red": { label: "lrc.red", url: "https://lrc.red/?utm_source=spicylyrics" },
};

export function ApplyLyricsProvider(data: any, LyricsContainer: HTMLElement): void {
  if (!data?.source || !LyricsContainer) return;

  // Plain credit line: the fork fetches from the Spicy Lyrics service only, so
  // there is no source for the reader to switch to.
  const ProviderElement = document.createElement("div");
  ProviderElement.classList.add("LyricsProvider");

  let providerLabel = resolveLyricsSourceLabel(data.source, data.sourceDisplayName, data.fetchProvider) ?? "Unknown";
  if (providerLabel === "Unknown" && typeof data.source === "string") {
    const source = data.source.toLowerCase();
    const match = Object.entries(ProviderMap).find(([key]) => source.includes(key));
    if (match) providerLabel = match[1];
  }

  CreditsRow(ProviderElement, "Provided by", providerLabel);

  // Own keys only: a value such as "constructor" would otherwise find Object.prototype's.
  const via =
    typeof data.source_via === "string" && Object.hasOwn(ViaMap, data.source_via)
      ? ViaMap[data.source_via]
      : undefined;
  if (via) {
    const ViaElement = document.createElement("span");
    ViaElement.classList.add("LyricsProviderVia");
    const ViaLabelElement = document.createElement("span");
    ViaLabelElement.classList.add("LyricsProviderViaLabel");
    ViaLabelElement.textContent = `via ${via.label}`;
    ViaElement.append(ViaLabelElement);
    ProviderElement.append(" ", ViaElement);
  }

  LyricsContainer.appendChild(ProviderElement);
}
