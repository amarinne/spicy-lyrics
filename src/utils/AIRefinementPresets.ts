export type AIRefinementPreset = {
  id: string;
  name: string;
  instructions: string;
  builtIn: boolean;
};

export const DEFAULT_AI_REFINEMENT_PRESET_ID = "natural-contextual";
export const DEFAULT_AI_SOUND_PRESET_ID = "readable-pronunciation";

export const BUILT_IN_AI_REFINEMENT_PRESETS: ReadonlyArray<AIRefinementPreset> = [
  {
    id: DEFAULT_AI_REFINEMENT_PRESET_ID,
    name: "Natural and contextual",
    instructions: "Make the complete output natural and contextual. Improve materially inaccurate, awkward, or inconsistent wording while retaining passages that already work when an alternative would not be better. Keep the song's tone, register, cultural nuance, and mixed-language phrasing.",
    builtIn: true,
  },
  {
    id: "faithful",
    name: "Faithful",
    instructions: "Stay close to the source meaning without becoming mechanical. Preserve ambiguity, repetition, imagery, and emotional intensity when the source supports them.",
    builtIn: true,
  },
  {
    id: "mixed-language",
    name: "Mixed language",
    instructions: "Review every phrase independently. Translate phrases that need translation, preserve intentional code-switching, and keep mixed-language lines natural as a whole.",
    builtIn: true,
  },
  {
    id: "cultural-nuance",
    name: "Cultural nuance",
    instructions: "Preserve cultural references, honorifics, slang, dialect, and implied meaning. Prefer an equivalent natural effect over a mechanical word-for-word rendering.",
    builtIn: true,
  },
  {
    id: "voices",
    name: "Voices and duet roles",
    instructions: "Keep distinct voices, address, pronouns, and conversational turns consistent. Do not invent singer identity or gender where the lyrics do not establish them.",
    builtIn: true,
  },
];

export const BUILT_IN_AI_SOUND_PRESETS: ReadonlyArray<AIRefinementPreset> = [
  {
    id: DEFAULT_AI_SOUND_PRESET_ID,
    name: "Readable pronunciation",
    instructions: "Use clear, readable pronunciation in the requested target orthography. Keep spelling and word boundaries consistent across repeated phrases and names.",
    builtIn: true,
  },
  {
    id: "source-close-pronunciation",
    name: "Source-close pronunciation",
    instructions: "Stay close to the source pronunciation. Avoid substitutions made only to resemble an English spelling convention, while remaining readable in the requested target orthography.",
    builtIn: true,
  },
  {
    id: "mixed-language-pronunciation",
    name: "Mixed language",
    instructions: "Handle each language segment independently. Preserve text already readable in the target orthography and keep code-switching, names, and repeated phrases consistent.",
    builtIn: true,
  },
];

function builtInPresets(layer: "meaning" | "sound"): ReadonlyArray<AIRefinementPreset> {
  return layer === "sound" ? BUILT_IN_AI_SOUND_PRESETS : BUILT_IN_AI_REFINEMENT_PRESETS;
}

export function parseCustomAIRefinementPresets(value: string, layer: "meaning" | "sound" = "meaning"): AIRefinementPreset[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 32).flatMap((item) => {
      if (!item || typeof item.id !== "string" || typeof item.name !== "string" || typeof item.instructions !== "string") return [];
      const id = item.id.trim();
      const name = item.name.normalize("NFC").trim().slice(0, 80);
      const instructions = item.instructions.normalize("NFC").trim();
      if (!id || !name || !instructions || builtInPresets(layer).some((preset) => preset.id === id)) return [];
      return [{ id, name, instructions, builtIn: false }];
    });
  } catch {
    return [];
  }
}

export function allAIRefinementPresets(customJson: string, layer: "meaning" | "sound" = "meaning"): AIRefinementPreset[] {
  return [...builtInPresets(layer), ...parseCustomAIRefinementPresets(customJson, layer)];
}

export function resolveAIRefinementPreset(customJson: string, id: string, layer: "meaning" | "sound" = "meaning"): AIRefinementPreset {
  return allAIRefinementPresets(customJson, layer).find((preset) => preset.id === id)
    ?? builtInPresets(layer)[0];
}

export function saveCustomAIRefinementPreset(customJson: string, preset: Omit<AIRefinementPreset, "builtIn">, layer: "meaning" | "sound" = "meaning"): { json: string; preset: AIRefinementPreset } {
  const current = parseCustomAIRefinementPresets(customJson, layer);
  const saved: AIRefinementPreset = {
    id: preset.id.trim(),
    name: preset.name.normalize("NFC").trim().slice(0, 80),
    instructions: preset.instructions.normalize("NFC").trim(),
    builtIn: false,
  };
  if (!saved.id || !saved.name || !saved.instructions) throw new TypeError("invalid_preset");
  const next = [...current.filter((item) => item.id !== saved.id), saved].slice(-32);
  return { json: JSON.stringify(next.map(({ id, name, instructions }) => ({ id, name, instructions }))), preset: saved };
}

export function deleteCustomAIRefinementPreset(customJson: string, id: string, layer: "meaning" | "sound" = "meaning"): string {
  return JSON.stringify(parseCustomAIRefinementPresets(customJson, layer).filter((preset) => preset.id !== id).map(({ name, instructions, id: presetId }) => ({ id: presetId, name, instructions })));
}
