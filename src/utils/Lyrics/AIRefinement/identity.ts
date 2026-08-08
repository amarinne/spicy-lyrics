const encoder = new TextEncoder();

function normalizeCanonical(value: unknown, path: string): unknown {
  if (value === undefined) throw new TypeError(`undefined is forbidden at ${path}`);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return value.normalize("NFC");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`non-finite number at ${path}`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => normalizeCanonical(item, `${path}[${index}]`));
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key.normalize("NFC")] = normalizeCanonical(source[key], `${path}.${key}`);
    return out;
  }
  throw new TypeError(`unsupported canonical value at ${path}`);
}

export function canonicalSerialize(value: unknown): string { return JSON.stringify(normalizeCanonical(value, "$")); }
export async function sha256Hex(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(canonicalSerialize(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function utf8Bytes(value: string): number { return encoder.encode(value).byteLength; }
