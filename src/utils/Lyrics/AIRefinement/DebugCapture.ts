export type ProviderExchangeCapture = {
  schema: 1;
  capturedAt: string;
  providerId: string;
  endpoint: string;
  model: string;
  repair: boolean;
  status: number;
  request: unknown;
  response: unknown;
};

export type LyricsSourceEvidence = {
  provider: string | null;
  label: string | null;
  format: "Syllable" | "Line" | "Static" | null;
};

export type DurableProviderCapture = {
  id: string;
  schema: 1;
  createdAt: number;
  updatedAt: number;
  enabled: boolean;
  trackUri: string | null;
  trackLabel: string | null;
  layer: "meaning" | "sound";
  pronunciationSystem?: string;
  source?: LyricsSourceEvidence;
  baseline: Array<{ id: string; baseline: string }>;
  accepted?: Record<string, string>;
  exchanges: ProviderExchangeCapture[];
};

export type ProviderComparisonAttempt = { number: number; text: string; model: string; repair: boolean; accepted: boolean };
export type ProviderComparisonRow = { id: string; original: string; baseline: string; attempts: ProviderComparisonAttempt[] };
export type MeaningComparisonDocument = { captures: number; rows: ProviderComparisonRow[]; modelName: string | null; instructions: string | null };
export type CurrentComparisonRow = { id: string; original: string; baseline: string };
export type LayerComparisonOptions = { currentRows: ReadonlyArray<CurrentComparisonRow>; requireBaselineMatch?: boolean; pronunciationSystem?: string };
export type CaptureState = { enabled: boolean; durable: boolean; captureId: string | null; activeCaptureId: string | null; exchanges: ReadonlyArray<ProviderExchangeCapture> };
export type ProviderCaptureSummary = { id: string; trackUri: string | null; trackLabel: string | null; layer: "meaning" | "sound"; sourceLabel: string | null; model: string | null; attempts: number; updatedAt: number };

const activeCaptures = new Map<string, DurableProviderCapture>();
let selectedCapture: DurableProviderCapture | null = null;
let comparisonCaptures: DurableProviderCapture[] = [];
let writeChain = Promise.resolve();
const listeners = new Set<(state: CaptureState) => void>();

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `capture-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function notify(): void {
  const state = getProviderCaptureState();
  for (const listener of listeners) listener(state);
}

function latestActiveCapture(): DurableProviderCapture | null { return Array.from(activeCaptures.values()).at(-1) ?? null; }
function displayedCapture(): DurableProviderCapture | null { return selectedCapture ?? latestActiveCapture(); }
function sameComparisonGroup(left: DurableProviderCapture, right: DurableProviderCapture): boolean {
  return left.trackUri === right.trackUri
    && (left.layer ?? "meaning") === (right.layer ?? "meaning")
    && (left.pronunciationSystem ?? null) === (right.pronunciationSystem ?? null)
    && (left.source?.provider ?? null) === (right.source?.provider ?? null)
    && (left.source?.format ?? null) === (right.source?.format ?? null);
}
function setSelectedCapture(record: DurableProviderCapture, records: DurableProviderCapture[]): void {
  selectedCapture = { ...structuredClone(record), enabled: false };
  comparisonCaptures = records.filter((candidate) => sameComparisonGroup(candidate, record)).sort((left, right) => left.createdAt - right.createdAt).map((candidate) => ({ ...structuredClone(candidate), enabled: false }));
}

function persist(record: DurableProviderCapture): void {
  if (typeof indexedDB === "undefined") return;
  const snapshot = structuredClone(record);
  writeChain = writeChain.then(async () => {
    const { dbPromise, ObjectStores } = await import("../../db.ts");
    const db = await dbPromise;
    await db.put(ObjectStores.AICaptures, snapshot);
  }).catch(() => undefined);
}

export function getProviderCaptureState(): CaptureState {
  const shown = displayedCapture();
  return { enabled: activeCaptures.size > 0, durable: !!shown, captureId: shown?.id ?? null, activeCaptureId: shown && activeCaptures.has(shown.id) ? shown.id : latestActiveCapture()?.id ?? null, exchanges: shown?.exchanges.map((exchange) => structuredClone(exchange)) ?? [] };
}

export function getActiveProviderCaptureId(): string | null {
  return latestActiveCapture()?.id ?? null;
}

export function subscribeProviderCapture(listener: (state: CaptureState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function loadLatestProviderCapture(): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  await writeChain;
  const { dbPromise, ObjectStores } = await import("../../db.ts");
  const records = await (await dbPromise).getAll(ObjectStores.AICaptures) as DurableProviderCapture[];
  const latest = records.sort((left, right) => right.updatedAt - left.updatedAt)[0];
  if (!latest) return false;
  setSelectedCapture(latest, records);
  notify();
  return true;
}

export async function listProviderCaptures(): Promise<ProviderCaptureSummary[]> {
  if (typeof indexedDB === "undefined") return [];
  await writeChain;
  const { dbPromise, ObjectStores } = await import("../../db.ts");
  const records = await (await dbPromise).getAll(ObjectStores.AICaptures) as DurableProviderCapture[];
  return records.sort((left, right) => right.updatedAt - left.updatedAt).map((record) => ({
    id: record.id,
    trackUri: record.trackUri,
    trackLabel: record.trackLabel,
    layer: record.layer ?? "meaning",
    sourceLabel: record.source?.label ?? null,
    model: record.exchanges.at(-1)?.model ?? null,
    attempts: record.exchanges.length,
    updatedAt: record.updatedAt,
  }));
}

export async function selectProviderCapture(id: string): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  await writeChain;
  const { dbPromise, ObjectStores } = await import("../../db.ts");
  const db = await dbPromise;
  const selected = await db.get(ObjectStores.AICaptures, id) as DurableProviderCapture | undefined;
  if (!selected) return false;
  const records = await db.getAll(ObjectStores.AICaptures) as DurableProviderCapture[];
  setSelectedCapture(selected, records);
  notify();
  return true;
}

export async function deleteProviderCapture(): Promise<boolean> {
  const id = displayedCapture()?.id;
  if (!id || activeCaptures.has(id)) return false;
  selectedCapture = null;
  comparisonCaptures = [];
  if (id && typeof indexedDB !== "undefined") {
    await writeChain;
    const { dbPromise, ObjectStores } = await import("../../db.ts");
    await (await dbPromise).delete(ObjectStores.AICaptures, id);
  }
  notify();
  await loadLatestProviderCapture();
  return true;
}

export function clearProviderCapture(): void { activeCaptures.clear(); selectedCapture = null; comparisonCaptures = []; notify(); }

export async function deleteAllProviderCaptures(): Promise<boolean> {
  if (activeCaptures.size) return false;
  selectedCapture = null;
  comparisonCaptures = [];
  if (typeof indexedDB !== "undefined") {
    await writeChain;
    const { dbPromise, ObjectStores } = await import("../../db.ts");
    await (await dbPromise).clear(ObjectStores.AICaptures);
  }
  notify();
  return true;
}

export function captureProviderBaseline(trackUri: string, trackLabel: string | null, rows: ReadonlyArray<{ id: string; baselineTranslatedText?: string }>, layer: "meaning" | "sound" = "meaning", source?: LyricsSourceEvidence, pronunciationSystem?: string): string {
  const now = Date.now();
  const activeCapture = {
    id: newId(), schema: 1, createdAt: now, updatedAt: now, enabled: true, trackUri, trackLabel, layer,
    source: source ? structuredClone(source) : undefined, pronunciationSystem,
    baseline: rows.map((row) => ({ id: row.id, baseline: row.baselineTranslatedText ?? "" })), accepted: {}, exchanges: [],
  };
  activeCaptures.set(activeCapture.id, activeCapture);
  selectedCapture = activeCapture;
  persist(activeCapture); notify();
  return activeCapture.id;
}

export function captureProviderAcceptedItems(captureId: string | null, items: ReadonlyArray<{ id: string; t: string }>): void {
  if (!captureId) return;
  const activeCapture = activeCaptures.get(captureId);
  if (!activeCapture) return;
  activeCapture.accepted = { ...activeCapture.accepted };
  for (const item of items) activeCapture.accepted[item.id] = item.t;
  activeCapture.updatedAt = Date.now();
  if (selectedCapture?.id === captureId) selectedCapture = activeCapture;
  persist(activeCapture); notify();
}

export function captureProviderExchange(captureId: string | null, exchange: ProviderExchangeCapture): void {
  if (!captureId) return;
  const activeCapture = activeCaptures.get(captureId);
  if (!activeCapture) return;
  activeCapture.exchanges = [...activeCapture.exchanges, structuredClone(exchange)];
  activeCapture.updatedAt = Date.now();
  if (selectedCapture?.id === captureId) selectedCapture = activeCapture;
  persist(activeCapture); notify();
}

export function finishProviderCapture(captureId: string | null): void {
  if (!captureId) return;
  const activeCapture = activeCaptures.get(captureId);
  if (!activeCapture) return;
  activeCapture.enabled = false;
  if (selectedCapture?.id === captureId) selectedCapture = activeCapture;
  persist(activeCapture);
  activeCaptures.delete(captureId);
  notify();
}

async function saveJson(filename: string, contents: string): Promise<string | null> {
  const picker = (window as any).showSaveFilePicker as ((options: unknown) => Promise<any>) | undefined;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [{ description: "JSON capture", accept: { "application/json": [".json"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(contents);
      await writable.close();
      return filename;
    } catch (error) {
      if ((error as any)?.name === "AbortError") return null;
      throw error;
    }
  }
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  queueMicrotask(() => URL.revokeObjectURL(url));
  return filename;
}

function filenamePart(value: string | null | undefined, fallback: string, maxLength: number): string {
  const printable = Array.from((value ?? "").normalize("NFC"), (character) => {
    const code = character.codePointAt(0)!;
    return code <= 0x1f || code === 0x7f ? "-" : character;
  }).join("");
  const sanitized = printable
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/[\s—–-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, maxLength);
  return sanitized || fallback;
}

export function providerCaptureFilename(capture: DurableProviderCapture): string {
  const track = filenamePart(capture.trackLabel ?? capture.trackUri, "unknown-track", 96);
  const model = filenamePart(capture.exchanges.at(-1)?.model, "model", 64);
  const timestamp = new Date(capture.updatedAt).toISOString().replace(/[:.]/g, "-");
  return `spicy-ai-capture-${track}-${model}-${timestamp}.json`;
}

export async function downloadProviderCapture(): Promise<string | null> {
  const shown = displayedCapture();
  if (!shown?.exchanges.length) return null;
  const filename = providerCaptureFilename(shown);
  return saveJson(filename, JSON.stringify(shown, null, 2));
}

export async function downloadAllProviderCaptures(): Promise<{ filename: string; count: number } | null> {
  if (typeof indexedDB === "undefined") return null;
  await writeChain;
  const { dbPromise, ObjectStores } = await import("../../db.ts");
  const records = await (await dbPromise).getAll(ObjectStores.AICaptures) as DurableProviderCapture[];
  if (!records.length) return null;
  records.sort((left, right) => right.updatedAt - left.updatedAt);
  const filename = `spicy-ai-captures-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const saved = await saveJson(filename, JSON.stringify({ schema: 1, exportedAt: new Date().toISOString(), captures: records }, null, 2));
  return saved ? { filename: saved, count: records.length } : null;
}

function parseJsonObject(value: unknown): any | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  try { return JSON.parse(fenced ? fenced[1] : trimmed); } catch { return null; }
}

function exchangeRequestItems(exchange: ProviderExchangeCapture): Array<{ id: string; s: string }> {
  const request = exchange.request as any;
  const openAIContent = Array.isArray(request?.messages) ? request.messages.find((message: any) => message?.role === "user")?.content : null;
  const geminiContent = Array.isArray(request?.contents) ? request.contents.flatMap((content: any) => content?.parts ?? []).map((part: any) => typeof part?.text === "string" ? part.text : "").join("") : null;
  const parsed = parseJsonObject(openAIContent ?? geminiContent);
  return Array.isArray(parsed?.items) ? parsed.items.filter((item: any) => typeof item?.id === "string" && typeof item?.s === "string").map((item: any) => ({ id: item.id, s: item.s })) : [];
}

function captureOriginals(capture: DurableProviderCapture): Map<string, string> {
  const originals = new Map<string, string>();
  for (const exchange of capture.exchanges) {
    for (const item of exchangeRequestItems(exchange)) if (!originals.has(item.id)) originals.set(item.id, item.s);
  }
  return originals;
}

function sameBaseline(left: ReadonlyArray<{ id: string; baseline: string }>, right: ReadonlyArray<CurrentComparisonRow>): boolean {
  if (left.length !== right.length) return false;
  const rightById = new Map(right.map((row) => [row.id, row.baseline]));
  return left.every((row) => rightById.get(row.id) === row.baseline);
}

function continuesCapture(previous: DurableProviderCapture, current: DurableProviderCapture): boolean {
  if (!sameComparisonGroup(previous, current) || previous.baseline.length !== current.baseline.length) return false;
  const previousBaseline = new Map(previous.baseline.map((row) => [row.id, row.baseline]));
  const currentBaseline = new Map(current.baseline.map((row) => [row.id, row.baseline]));
  return previous.baseline.every((row) => currentBaseline.get(row.id) === (previous.accepted?.[row.id] ?? previousBaseline.get(row.id)));
}

function matchesCurrentSource(capture: DurableProviderCapture, currentRows: ReadonlyArray<CurrentComparisonRow>): boolean {
  if (capture.baseline.length !== currentRows.length) return false;
  const currentById = new Map(currentRows.map((row) => [row.id, row]));
  if (!capture.baseline.every((row) => currentById.has(row.id))) return false;
  for (const [id, source] of captureOriginals(capture)) if (currentById.get(id)?.original !== source) return false;
  return true;
}

export function selectCurrentComparisonCaptures(records: ReadonlyArray<DurableProviderCapture>, options: LayerComparisonOptions): DurableProviderCapture[] {
  const ordered = records.filter((record) => matchesCurrentSource(record, options.currentRows)
    && (!options.pronunciationSystem || record.pronunciationSystem === options.pronunciationSystem)).sort((left, right) => left.createdAt - right.createdAt);
  if (!options.requireBaselineMatch) return ordered;
  const selected: DurableProviderCapture[] = [];
  for (const record of ordered) {
    // Revisions inherit compatibility from their own prior accepted output, even when another mode's run is interleaved.
    if (sameBaseline(record.baseline, options.currentRows) || selected.some((previous) => continuesCapture(previous, record))) selected.push(record);
  }
  return selected;
}

function exchangeResponseItems(exchange: ProviderExchangeCapture): Array<{ id: string; t: string }> {
  const response = exchange.response as any;
  const openAIContent = response?.choices?.[0]?.message?.content;
  const normalizedOpenAIContent = Array.isArray(openAIContent) ? openAIContent.map((part: any) => typeof part?.text === "string" ? part.text : typeof part === "string" ? part : "").join("") : openAIContent;
  const geminiContent = Array.isArray(response?.candidates?.[0]?.content?.parts) ? response.candidates[0].content.parts.map((part: any) => typeof part?.text === "string" ? part.text : "").join("") : null;
  const parsed = parseJsonObject(normalizedOpenAIContent ?? geminiContent);
  return Array.isArray(parsed?.items) ? parsed.items.filter((item: any) => typeof item?.id === "string" && typeof item?.t === "string").map((item: any) => ({ id: item.id, t: item.t })) : [];
}

export function getProviderComparisonRows(): ProviderComparisonRow[] {
  const shown = displayedCapture();
  if (!shown) return [];
  const captures = selectedCapture && comparisonCaptures.length ? comparisonCaptures : [shown];
  return buildProviderComparisonRows(captures);
}

export function buildProviderComparisonRows(captures: ReadonlyArray<DurableProviderCapture>): ProviderComparisonRow[] {
  if (!captures.length) return [];
  const originals = new Map<string, string>();
  const attempts = new Map<string, ProviderComparisonAttempt[]>();
  captures.forEach((capture, captureIndex) => {
    const responseById = new Map<string, { text: string; model: string; repair: boolean }>();
    for (const exchange of capture.exchanges) {
      for (const item of exchangeRequestItems(exchange)) if (!originals.has(item.id)) originals.set(item.id, item.s);
      for (const item of exchangeResponseItems(exchange)) responseById.set(item.id, { text: item.t, model: exchange.model, repair: exchange.repair });
    }
    const ids = new Set([...responseById.keys(), ...Object.keys(capture.accepted ?? {})]);
    for (const id of ids) {
      const response = responseById.get(id);
      const acceptedText = capture.accepted?.[id];
      const text = acceptedText ?? response?.text;
      if (text === undefined) continue;
      const rowAttempts = attempts.get(id) ?? [];
      rowAttempts.push({ number: captureIndex + 1, text, model: response?.model ?? capture.exchanges.at(-1)?.model ?? "unknown", repair: response?.repair ?? false, accepted: acceptedText !== undefined });
      attempts.set(id, rowAttempts);
    }
  });
  const ids = new Set<string>([...captures.flatMap((capture) => capture.baseline.map((row) => row.id)), ...originals.keys(), ...attempts.keys()]);
  const baseline = new Map(captures[0].baseline.map((row) => [row.id, row.baseline]));
  return Array.from(ids).map((id) => ({ id, original: originals.get(id) ?? "", baseline: baseline.get(id) ?? "", attempts: attempts.get(id) ?? [] }));
}

export function buildCurrentProviderComparisonRows(captures: ReadonlyArray<DurableProviderCapture>, currentRows: ReadonlyArray<CurrentComparisonRow>): ProviderComparisonRow[] {
  const attemptsById = new Map(buildProviderComparisonRows(captures).map((row) => [row.id, row.attempts]));
  return currentRows.map((row) => ({ ...row, attempts: attemptsById.get(row.id) ?? [] }));
}

function exchangeInstructions(exchange: ProviderExchangeCapture | undefined): string | null {
  if (!exchange) return null;
  const request = exchange.request as any;
  const openAIText = request?.messages?.find?.((message: any) => message?.role === "user")?.content;
  const geminiText = request?.contents?.find?.((content: any) => content?.role === "user")?.parts?.map?.((part: any) => part?.text ?? "")?.join?.("");
  const text = typeof openAIText === "string" ? openAIText : typeof geminiText === "string" ? geminiText : "";
  try {
    const instructions = JSON.parse(text)?.instructions;
    return typeof instructions === "string" && instructions.trim() ? instructions.trim() : null;
  } catch { return null; }
}

export async function loadLayerComparisonRows(trackUri: string, layer: "meaning" | "sound", options?: LayerComparisonOptions): Promise<MeaningComparisonDocument> {
  if (typeof indexedDB === "undefined") return { captures: 0, rows: [], modelName: null, instructions: null };
  await writeChain;
  const { dbPromise, ObjectStores } = await import("../../db.ts");
  let records = (await (await dbPromise).getAll(ObjectStores.AICaptures) as DurableProviderCapture[])
    .filter((record) => record.trackUri === trackUri && (record.layer ?? "meaning") === layer)
    .sort((left, right) => left.createdAt - right.createdAt);
  if (options) records = selectCurrentComparisonCaptures(records, options);
  if (!records.length) return { captures: 0, rows: [], modelName: null, instructions: null };
  const latest = records.at(-1)!;
  const compatible = records.filter((record) => sameComparisonGroup(record, latest));
  const latestExchange = latest.exchanges.at(-1);
  const rows = options ? buildCurrentProviderComparisonRows(compatible, options.currentRows) : buildProviderComparisonRows(compatible);
  return { captures: compatible.length, rows, modelName: latestExchange?.model ?? null, instructions: exchangeInstructions(latestExchange) };
}

export function loadMeaningComparisonRows(trackUri: string): Promise<MeaningComparisonDocument> {
  return loadLayerComparisonRows(trackUri, "meaning");
}

export function getProviderCaptureMetadata(): { model: string; providerId: string; endpoint: string; attempts: number; versions: number; systemPrompt: string; trackUri: string | null; trackLabel: string | null; layer: "meaning" | "sound"; source: LyricsSourceEvidence | null; updatedAt: number } | null {
  const shown = displayedCapture();
  const latest = shown?.exchanges.at(-1);
  if (!shown || !latest) return null;
  const messages = (latest.request as any)?.messages;
  const systemPrompt = Array.isArray(messages)
    ? messages.find((message) => message?.role === "system")?.content
    : (latest.request as any)?.systemInstruction?.parts?.map((part: any) => typeof part?.text === "string" ? part.text : "").join("") ?? "";
  return { model: latest.model, providerId: latest.providerId, endpoint: latest.endpoint, attempts: shown.exchanges.length, versions: selectedCapture && comparisonCaptures.length ? comparisonCaptures.length : 1, systemPrompt: typeof systemPrompt === "string" ? systemPrompt : "", trackUri: shown.trackUri, trackLabel: shown.trackLabel, layer: shown.layer ?? "meaning", source: shown.source ? structuredClone(shown.source) : null, updatedAt: shown.updatedAt };
}
