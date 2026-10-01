// Offline "embedding": hash each word into one of 1536 buckets (+1 or -1), then normalize.
// "Similar" means shared words. Shared by the MCP server (when there's no OpenAI key) and the
// Claude Code plugin's prompt hook, so both score a pair the same way. No dependencies.
import { createHash } from "node:crypto";

export const DIM = 1536;
// Word hashing scores lower than a real model for the same pair, so it gets a lower cutoff.
export const HASH_MIN_SIM = 0.3;

const STOP = new Set("a an and are as at be but by can do does for from how i in is it me my of on or our so that the this to us we what when will with you your".split(" "));

export function hashEmbed(text) {
  const v = new Array(DIM).fill(0);
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []) {
    if (STOP.has(w)) continue;
    const n = createHash("sha256").update(w).digest().readBigUInt64BE(0);
    v[Number(n % BigInt(DIM))] += (n >> 63n) === 0n ? 1 : -1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}
