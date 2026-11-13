/** Local-only g2pM prototype loader. Reading selection lives in the portable engine. */
import { createMandarinEngine } from "./MandarinG2pm/engine.ts";
import type { MandarinEngine, MandarinEngineAssets, MandarinReadingLine } from "./MandarinG2pm/contracts.ts";
import { MANDARIN_READER_REVISION } from "./MandarinReaderIdentity.ts";

let engine: MandarinEngine | undefined;
let loading: Promise<void> | undefined;
let loadReceipt: { identity: string; milliseconds: number; packedBytes: number; initialization: unknown } | undefined;

function decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
async function sha256(bytes: Uint8Array): Promise<string> {
  const result = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function ensureMandarinReader(): Promise<void> {
  loading ??= (async () => {
    const start = performance.now();
    const { identity, encoded } = await import("./MandarinG2pm/assets.generated.ts");
    const packed = decode(encoded);
    const stream = new Blob([packed as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("gzip"));
    const unpacked = new Uint8Array(await new Response(stream).arrayBuffer());
    if (await sha256(unpacked) !== identity) throw new Error("Mandarin inline pack digest mismatch");
    const payload = JSON.parse(new TextDecoder().decode(unpacked));
    if (payload.schema !== 1) throw new Error("Unsupported Mandarin inline pack");
    const files: Record<string, string> = payload.files;
    const manifest = JSON.parse(files["manifest.json"]);
    for (const [name, receipt] of Object.entries(payload.receipts) as [string, { bytes: number; sha256: string }][]) {
      const bytes = name === "model.f32" ? decode(files[name]) : new TextEncoder().encode(files[name]);
      if (bytes.byteLength !== receipt.bytes || await sha256(bytes) !== receipt.sha256) {
        throw new Error(`Mandarin asset digest mismatch: ${name}`);
      }
      const source = manifest.files[name];
      if (name !== "manifest.json" && (!source || source.sha256 !== receipt.sha256 || source.bytes !== receipt.bytes)) {
        throw new Error(`Mandarin asset manifest mismatch: ${name}`);
      }
    }
    const model = decode(files["model.f32"]);
    const assets: MandarinEngineAssets = { manifest, model: model.buffer as ArrayBuffer,
      vocab: JSON.parse(files["model-vocab.json"]), classes: files["classes.txt"],
      characters: files["characters.tsv"], digest: files["digest.json"], phrases: files["phrases.tsv"], t2s: files["t2s.tsv"] };
    engine = createMandarinEngine(assets);
    loadReceipt = { identity, milliseconds: performance.now() - start, packedBytes: packed.byteLength,
      initialization: engine.telemetry().initialization };
  })();
  return loading;
}

export function readMandarinLine(text: string): MandarinReadingLine {
  if (!engine) throw new Error("Mandarin reader must load before reading a line");
  return engine.read(text);
}

/** Available through the existing developer-only testing API; no lyric capture or network call. */
export const mandarinReaderDebug = {
  ensure: ensureMandarinReader,
  read: readMandarinLine,
  telemetry: () => ({ revision: MANDARIN_READER_REVISION, load: loadReceipt, engine: engine?.telemetry() }),
};
