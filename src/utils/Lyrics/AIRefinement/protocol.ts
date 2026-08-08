import { isMeaningfullyDifferent } from "../TextCompare.ts";
import { sha256Hex, utf8Bytes } from "./identity.ts";
import { AI_CHUNK_PLAN_VERSION, AI_MAX_DOCUMENT_ROWS, AI_MAX_DOCUMENT_SOURCE_BYTES, AI_MAX_REQUEST_BYTES, AI_MAX_SOURCE_ITEM_BYTES, AI_MAX_TRANSLATED_ITEM_BYTES, type ChunkPlan, type EnumeratedLine, type ModelLimits, type PlannedChunk } from "./types.ts";

export const AI_SYSTEM_PROMPT = "Return JSON only with shape {\"items\":[{\"id\":string,\"t\":string}]}. Return every requested id exactly once. Translate rather than romanize. Respect ordinary/adlib class. Preserve the exact ' / ' delimiter count and ordered segment count. Do not add ids, omit ids, merge rows, split rows, number output, or use Markdown. If refusing one item, return its source unchanged.";
export const AI_REPAIR_PROMPT = "The prior response violated the JSON or item contract. Return the complete chunk again, satisfying it exactly.";

export async function buildDocumentDigest(rows: ReadonlyArray<EnumeratedLine>): Promise<string> {
  return sha256Hex(rows.map(({ id, class: lineClass, sendDisposition, sourceText }) => ({ id, class: lineClass, sendDisposition, sourceText })));
}
export async function buildConfigId(value: { provider: string; providerVersion: string; endpoint?: string | null; modelName: string; targetLang: string; promptVersion: number; temperature: 0; contextMode: "document_or_v1_chunks" }): Promise<string> { return sha256Hex({ ...value, endpoint: value.endpoint ?? null }); }
function requestJson(target: string, items: ReadonlyArray<{ id: string; c: "ordinary" | "adlib"; s: string }>): string { return JSON.stringify({ target, items: items.map(({ id, c, s }) => ({ id, c, s })) }); }
function createChunk(id: string, target: string, items: ReadonlyArray<{ id: string; c: "ordinary" | "adlib"; s: string }>, model: ModelLimits): PlannedChunk {
  const json = requestJson(target, items);
  const sourceUtf8Bytes = items.reduce((sum, item) => sum + utf8Bytes(item.s), 0);
  const estimatedOutputTokens = Math.ceil(sourceUtf8Bytes / 2);
  const estimatedInputTokens = Math.ceil(utf8Bytes(AI_SYSTEM_PROMPT + json) / 2);
  if (utf8Bytes(AI_SYSTEM_PROMPT + json) > AI_MAX_REQUEST_BYTES || estimatedInputTokens > model.inputTokenLimit || estimatedOutputTokens > model.outputTokenLimit) throw new RangeError("oversized");
  return { id, items, requestJson: json, sourceUtf8Bytes, estimatedInputTokens, estimatedOutputTokens };
}

export function planChunks(rows: ReadonlyArray<EnumeratedLine>, target: string, model: ModelLimits): ChunkPlan {
  if (rows.length > AI_MAX_DOCUMENT_ROWS) throw new RangeError("oversized");
  const canonicalSourceUtf8Bytes = rows.reduce((sum, item) => sum + utf8Bytes(item.sourceText), 0);
  if (canonicalSourceUtf8Bytes > AI_MAX_DOCUMENT_SOURCE_BYTES) throw new RangeError("oversized");
  const sent = rows.filter((line) => line.sendDisposition === "sent").map((line) => {
    if (utf8Bytes(line.sourceText) > AI_MAX_SOURCE_ITEM_BYTES) throw new RangeError("oversized");
    return { id: line.id, c: line.class as "ordinary" | "adlib", s: line.sourceText };
  });
  if (!sent.length) return { version: AI_CHUNK_PLAN_VERSION, chunks: [], enumerableRows: rows.length, canonicalSourceUtf8Bytes };
  const sentBytes = sent.reduce((sum, item) => sum + utf8Bytes(item.s), 0);
  if (sent.length <= 128 && sentBytes <= 16 * 1024 && Math.ceil(sentBytes / 2) <= 6_144) {
    try { return { version: AI_CHUNK_PLAN_VERSION, chunks: [createChunk("C0", target, sent, model)], enumerableRows: rows.length, canonicalSourceUtf8Bytes }; } catch (error) { if (!(error instanceof RangeError)) throw error; }
  }
  const chunks: PlannedChunk[] = [];
  let current: typeof sent = [];
  let currentBytes = 0;
  const close = () => { if (!current.length) return; chunks.push(createChunk(`C${chunks.length}`, target, current, model)); current = []; currentBytes = 0; };
  for (const item of sent) {
    const itemBytes = utf8Bytes(item.s);
    const candidate = [...current, item];
    let fits = candidate.length <= 64 && currentBytes + itemBytes <= 8 * 1024;
    if (fits) { try { createChunk("probe", target, candidate, model); } catch { fits = false; } }
    if (!fits) close();
    current.push(item); currentBytes += itemBytes;
    try { createChunk("probe", target, current, model); } catch { throw new RangeError("oversized"); }
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
export function validateProviderJson(raw: string, requested: ReadonlyArray<{ id: string; c: "ordinary" | "adlib"; s: string }>): Array<{ id: string; t: string }> {
  let parsed: unknown;
  try { parsed = JSON.parse(stripSingleFence(raw)); } catch { throw new TypeError("invalid_json"); }
  return validateProviderItems((parsed as any)?.items, requested);
}
export function validateProviderItems(items: unknown, requested: ReadonlyArray<{ id: string; c: "ordinary" | "adlib"; s: string }>): Array<{ id: string; t: string }> {
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
    if (source.c === "ordinary" && (!item.t.trim() || !isMeaningfullyDifferent(item.t, source.s))) throw new TypeError("unchanged_ordinary");
    if (source.s.split(" / ").length !== item.t.split(" / ").length) throw new TypeError("delimiter_mismatch");
    out.push({ id: item.id, t: item.t });
  }
  if (seen.size !== requestedById.size) throw new TypeError("id_set_mismatch");
  return out;
}
