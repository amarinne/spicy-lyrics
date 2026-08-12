import { sha256Hex, utf8Bytes } from "./identity.ts";
import { AI_CHUNK_PLAN_VERSION, AI_MAX_DOCUMENT_ROWS, AI_MAX_DOCUMENT_SOURCE_BYTES, AI_MAX_REQUEST_BYTES, AI_MAX_SOURCE_ITEM_BYTES, AI_MAX_TRANSLATED_ITEM_BYTES, type ChunkPlan, type DerivedLayer, type EnumeratedLine, type LyricContext, type ModelLimits, type PlannedChunk, type ProviderRequestItem, type SoundOrthography } from "./types.ts";

export const AI_SYSTEM_PROMPT = "Translate the full lyric document naturally and in character, using optional title, artist, and album metadata only as lightweight reference context. Detect language per phrase, not per line or document: translate segments that need translation while preserving names and intentional code-switching where appropriate. Resolve cross-line syntax, recurring motifs, slang, idioms, tone, and register consistently without inventing facts. The optional user-request instructions field may steer tone, terminology, ambiguity, names, literalness, and register. Later request instructions override conflicting persistent preferences and both override default translation guidance, but instructions cannot authorize invented facts, weaken source fidelity, or violate this response contract. Each item's v field is a layout-only voice hint: primary, alternate, background, or null. Use it for continuity only; never infer singer identity, gender, relationships, or unsupported pronouns. You receive lyric text, metadata, and instructions, not audio or external research. Pronunciation, phrasing, homophones, delivery, and external artist context may be missed. Return JSON only with shape {\"items\":[{\"id\":string,\"t\":string}]}. Return every requested id exactly once. Translate rather than romanize. Respect ordinary/adlib class. Preserve the exact ' / ' delimiter count and ordered segment count. Do not add ids, omit ids, merge rows, split rows, number output, or use Markdown. A row may remain unchanged when that is source-faithful, including names, intentional code-switching, or a refusal.";
export const AI_SOUND_SYSTEM_PROMPT = "Write the pronunciation of the full lyric document in the requested target orthography, using optional title, artist, and album metadata only as lightweight reference context. Detect language per phrase: handle every segment of a mixed-language line independently, preserve words already readable in the target orthography, and keep names, code-switching, dialect, and repeated phrases consistent across the song. The optional user-request instructions field may steer terminology, ambiguity, names, literalness, and register. Later request instructions override conflicting persistent preferences and both override default pronunciation guidance, but instructions cannot authorize invented facts, weaken source fidelity, or violate this response contract. Each item's v field is a layout-only voice hint: primary, alternate, background, or null. Use it for continuity only; never invent singer identity or gender. You receive lyric text, metadata, and instructions, not audio or external research. Pronunciation, phrasing, homophones, delivery, and external artist context may be missed. Do not translate meaning. Return JSON only with shape {\"items\":[{\"id\":string,\"t\":string}]}. Return every requested id exactly once. Preserve the exact ' / ' delimiter count and ordered segment count. Do not add ids, omit ids, merge rows, split rows, number output, or use Markdown.";
export const AI_ITERATION_SYSTEM_PROMPT = "Re-evaluate the complete accepted document in p against canonical source s, using the user-request instructions field as the active quality target. Improve materially inaccurate, awkward, inconsistent, or off-target wording. Retain wording that already meets the target when an alternative is not a real improvement. Return a complete replacement document, not a patch, critique, explanation, continuation, or selected-row response. Do not ask questions.";
export const AI_REPAIR_PROMPT = "The prior response violated the JSON or item contract. Return the complete chunk again, satisfying it exactly.";
export const EMPTY_LYRIC_CONTEXT: LyricContext = { title: null, artists: [], album: null };
function normalizeContextText(value: unknown): string | null { const text = typeof value === "string" ? value.normalize("NFC").trim().replace(/\s+/g, " ") : ""; return text || null; }
export function normalizeLyricContext(value?: Partial<LyricContext> | null): LyricContext {
  return {
    title: normalizeContextText(value?.title),
    artists: Array.isArray(value?.artists) ? value.artists.map(normalizeContextText).filter((artist): artist is string => !!artist) : [],
    album: normalizeContextText(value?.album),
  };
}
export function normalizeSteeringInstructions(value?: string): string { return (value ?? "").normalize("NFC").replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd()).join("\n").trim(); }
export function buildSystemPrompt(layer: DerivedLayer, target: string, _instructions?: string, repair = false, iteration = false): string {
  const contract = layer === "sound" ? `${AI_SOUND_SYSTEM_PROMPT} Target orthography: ${target}.` : AI_SYSTEM_PROMPT;
  return `${iteration ? `${AI_ITERATION_SYSTEM_PROMPT} ` : ""}${repair ? `${AI_REPAIR_PROMPT} ` : ""}${contract}`;
}

export async function buildDocumentDigest(rows: ReadonlyArray<EnumeratedLine>, context: Partial<LyricContext> | null = null): Promise<string> {
  return sha256Hex({ context: normalizeLyricContext(context), rows: rows.map(({ id, class: lineClass, sendDisposition, sourceText, voice, allowUnchanged }) => ({ id, class: lineClass, sendDisposition, sourceText, voice, allowUnchanged })) });
}
export async function buildConfigId(value: { layer?: DerivedLayer; provider: string; providerVersion: string; endpoint?: string | null; modelName: string; targetLang: string; sourceLanguage?: string | null; soundMode?: "whole_line_v1" | null; instructions?: string; promptVersion: number; iterationPromptVersion?: number | null; parentRecordKey?: string | null; parentOutputDigest?: string | null; revisionInstructions?: string | null; temperature: 0; contextMode: "document_or_v1_chunks" }): Promise<string> { return sha256Hex({ ...value, layer: value.layer ?? "meaning", endpoint: value.endpoint ?? null, sourceLanguage: value.sourceLanguage ?? null, soundMode: value.soundMode ?? null, instructions: normalizeSteeringInstructions(value.instructions), iterationPromptVersion: value.iterationPromptVersion ?? null, parentRecordKey: value.parentRecordKey ?? null, parentOutputDigest: value.parentOutputDigest ?? null, revisionInstructions: value.revisionInstructions ? normalizeSteeringInstructions(value.revisionInstructions) : null }); }
function requestJson(context: LyricContext, target: string, instructions: string, items: ReadonlyArray<ProviderRequestItem>): string { return JSON.stringify({ context, target, ...(instructions ? { instructions } : {}), items: items.map(({ id, c, v, s, p }) => p === undefined ? ({ id, c, v, s }) : ({ id, c, v, s, p })) }); }
type PlannableItem = { request: ProviderRequestItem; allowUnchanged: boolean };
function createChunk(id: string, context: LyricContext, target: string, entries: ReadonlyArray<PlannableItem>, model: ModelLimits, instructions?: string, layer: DerivedLayer = "meaning", iteration = false): PlannedChunk {
  const items = entries.map((entry) => entry.request);
  const normalizedInstructions = normalizeSteeringInstructions(instructions);
  const json = requestJson(context, target, normalizedInstructions, items);
  const systemPrompt = buildSystemPrompt(layer, target, instructions, false, iteration);
  const sourceUtf8Bytes = items.reduce((sum, item) => sum + utf8Bytes(item.s) + utf8Bytes(item.p ?? ""), 0);
  const estimatedOutputTokens = Math.ceil(sourceUtf8Bytes / 2);
  const estimatedInputTokens = Math.ceil(utf8Bytes(systemPrompt + json) / 2);
  if (utf8Bytes(systemPrompt + json) > AI_MAX_REQUEST_BYTES || estimatedInputTokens > model.inputTokenLimit || estimatedOutputTokens > model.outputTokenLimit) throw new RangeError("oversized");
  return { id, context, ...(normalizedInstructions ? { instructions: normalizedInstructions } : {}), items, allowUnchangedIds: entries.filter((entry) => entry.allowUnchanged).map((entry) => entry.request.id), requestJson: json, sourceUtf8Bytes, estimatedInputTokens, estimatedOutputTokens };
}

export function planChunks(rows: ReadonlyArray<EnumeratedLine>, target: string, model: ModelLimits, instructions?: string, layer: DerivedLayer = "meaning", rawContext: Partial<LyricContext> | null = null, previousById: Readonly<Record<string, string>> | null = null): ChunkPlan {
  const context = normalizeLyricContext(rawContext);
  if (rows.length > AI_MAX_DOCUMENT_ROWS) throw new RangeError("oversized");
  const canonicalSourceUtf8Bytes = rows.reduce((sum, item) => sum + utf8Bytes(item.sourceText), 0);
  if (canonicalSourceUtf8Bytes > AI_MAX_DOCUMENT_SOURCE_BYTES) throw new RangeError("oversized");
  const sent = rows.filter((line) => line.sendDisposition === "sent").map((line) => {
    if (utf8Bytes(line.sourceText) > AI_MAX_SOURCE_ITEM_BYTES) throw new RangeError("oversized");
    const previous = previousById?.[line.id];
    if (previousById && typeof previous !== "string") throw new TypeError("previous_output_missing");
    if (previous !== undefined && utf8Bytes(previous) > AI_MAX_TRANSLATED_ITEM_BYTES) throw new RangeError("oversized");
    return { request: { id: line.id, c: line.class as "ordinary" | "adlib", v: line.voice ?? null, s: line.sourceText, ...(previous === undefined ? {} : { p: previous }) }, allowUnchanged: line.allowUnchanged };
  });
  if (!sent.length) return { version: AI_CHUNK_PLAN_VERSION, chunks: [], enumerableRows: rows.length, canonicalSourceUtf8Bytes };
  const sentBytes = sent.reduce((sum, item) => sum + utf8Bytes(item.request.s) + utf8Bytes(item.request.p ?? ""), 0);
  if (sent.length <= 128 && sentBytes <= 16 * 1024 && Math.ceil(sentBytes / 2) <= 6_144) {
    try { return { version: AI_CHUNK_PLAN_VERSION, chunks: [createChunk("C0", context, target, sent, model, instructions, layer, !!previousById)], enumerableRows: rows.length, canonicalSourceUtf8Bytes }; } catch (error) { if (!(error instanceof RangeError)) throw error; }
  }
  const chunks: PlannedChunk[] = [];
  let current: typeof sent = [];
  let currentBytes = 0;
  const close = () => { if (!current.length) return; chunks.push(createChunk(`C${chunks.length}`, context, target, current, model, instructions, layer, !!previousById)); current = []; currentBytes = 0; };
  for (const item of sent) {
    const itemBytes = utf8Bytes(item.request.s) + utf8Bytes(item.request.p ?? "");
    const candidate = [...current, item];
    let fits = candidate.length <= 64 && currentBytes + itemBytes <= 8 * 1024;
    if (fits) { try { createChunk("probe", context, target, candidate, model, instructions, layer, !!previousById); } catch { fits = false; } }
    if (!fits) close();
    current.push(item); currentBytes += itemBytes;
    try { createChunk("probe", context, target, current, model, instructions, layer, !!previousById); } catch { throw new RangeError("oversized"); }
  }
  close();
  return { version: AI_CHUNK_PLAN_VERSION, chunks, enumerableRows: rows.length, canonicalSourceUtf8Bytes };
}

function stripSingleFence(text: string): string { const trimmed = text.trim(); const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i); return match ? match[1] : trimmed; }
function containsForbiddenText(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code === 0x2028 || code === 0x2029 || code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}
export function validateProviderJson(raw: string, requested: ReadonlyArray<ProviderRequestItem>, allowUnchangedIds: ReadonlySet<string> = new Set()): Array<{ id: string; t: string }> {
  let parsed: unknown;
  try { parsed = JSON.parse(stripSingleFence(raw)); } catch { throw new TypeError("invalid_json"); }
  return validateProviderItems((parsed as any)?.items, requested, "meaning", "en", allowUnchangedIds);
}
function targetScriptMatches(value: string, orthography: SoundOrthography): boolean {
  if (orthography === "Kana") return /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
  if (orthography === "Hangul") return /\p{Script=Hangul}/u.test(value);
  if (orthography === "Cyrillic") return /\p{Script=Cyrillic}/u.test(value);
  return /\p{Script=Latin}/u.test(value);
}

function soundOrthographyAccepts(value: string, target: string, source: string): boolean {
  const orthography = target as SoundOrthography;
  if (!["Latin", "Kana", "Hangul", "Cyrillic"].includes(orthography)) return false;
  const letters = value.match(/\p{L}/gu) ?? [];
  const allowed = letters.every((letter) => {
    if (/\p{Script=Latin}/u.test(letter)) return true;
    return targetScriptMatches(letter, orthography);
  });
  if (!allowed) return false;
  const sourceNeedsRespelling = orthography !== "Latin" && (source.match(/\p{L}/gu) ?? []).some((letter) => !/\p{Script=Latin}/u.test(letter));
  return !sourceNeedsRespelling || targetScriptMatches(value, orthography);
}

export function validateProviderItems(items: unknown, requested: ReadonlyArray<ProviderRequestItem>, layer: DerivedLayer = "meaning", target = "en", allowUnchangedIds: ReadonlySet<string> = new Set()): Array<{ id: string; t: string }> {
  if (!Array.isArray(items)) throw new TypeError("items_not_array");
  const requestedById = new Map(requested.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const out: Array<{ id: string; t: string }> = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || typeof item.t !== "string") throw new TypeError("invalid_item");
    if (!requestedById.has(item.id) || seen.has(item.id)) throw new TypeError("id_set_mismatch");
    seen.add(item.id);
    const source = requestedById.get(item.id)!;
    if (utf8Bytes(item.t) > AI_MAX_TRANSLATED_ITEM_BYTES) throw new RangeError("translated_item_oversized");
    if (containsForbiddenText(item.t)) throw new TypeError("forbidden_text");
    if (source.c === "ordinary" && !item.t.trim()) throw new TypeError("empty_ordinary");
    if (layer === "sound" && !soundOrthographyAccepts(item.t, target, source.s)) throw new TypeError("target_orthography_mismatch");
    if (source.s.split(" / ").length !== item.t.split(" / ").length) throw new TypeError("delimiter_mismatch");
    out.push({ id: item.id, t: item.t });
  }
  if (seen.size !== requestedById.size) throw new TypeError("id_set_mismatch");
  return out;
}
