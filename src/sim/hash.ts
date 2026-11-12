// Stable state hash: FNV-1a (32-bit) over a canonical serialization with
// sorted object keys. Non-integer numbers are rejected so the sim state stays
// in integer subpixels.

export function canonicalStringify(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "number":
      if (!Number.isInteger(value)) {
        throw new Error(`canonicalStringify: non-integer number ${String(value)}`);
      }
      return String(value);
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "object": {
      if (Array.isArray(value)) {
        return "[" + value.map((item) => canonicalStringify(item)).join(",") + "]";
      }
      const record = value as Record<string, unknown>;
      const parts: string[] = [];
      for (const key of Object.keys(record).sort()) {
        const item = record[key];
        if (item === undefined) continue;
        parts.push(JSON.stringify(key) + ":" + canonicalStringify(item));
      }
      return "{" + parts.join(",") + "}";
    }
    default:
      throw new Error(`canonicalStringify: unsupported type ${typeof value}`);
  }
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a over UTF-16 code units, as a uint32. */
export function fnv1a32(text: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/** 8-hex-digit hash of any JSON-like value (sim state in practice). */
export function hashState(state: unknown): string {
  return fnv1a32(canonicalStringify(state)).toString(16).padStart(8, "0");
}
