// Offline "embedding": hash each word into one of 1536 buckets (+1 or -1), then normalize.
// "Similar" means shared words, after light English stemming so "shipping", "ships" and "ship"
// count as one word. Shared by the MCP server (when there's no OpenAI key) and the Claude Code
// plugin's prompt hook, so both score a pair the same way. No dependencies.
import { createHash } from "node:crypto";

export const DIM = 1536;
// Word hashing scores lower than a real model for the same pair, so it gets a lower cutoff.
export const HASH_MIN_SIM = 0.3;

const STOP = new Set("a an and are as at be but by can do does for from how i in is it me my of on or our so that the this to us we what when will with you your".split(" "));

// The id the server stores with its vectors; it re-embeds what's stored when this changes.
export const HASH_EMBEDDER = "hash-v2";

// Deliberately small: strip a plural, then -ing / -ed, then a doubled final consonant
// ("shipping" -> "shipp" -> "ship"). Stems needn't be real words, only consistent.
export function stem(w) {
  if (w.length <= 3 || /\d/.test(w)) return w;
  w = w.replace(/'s$/, "");
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (/(sh|ch|x|ss|z)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  if (/([b-df-hj-np-tv-z])\1$/.test(w) && !/(ll|ss|zz)$/.test(w)) w = w.slice(0, -1);
  return w;
}

export function hashEmbed(text) {
  const v = new Array(DIM).fill(0);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []) {
    if (STOP.has(word)) continue;
    const w = stem(word);
    const n = createHash("sha256").update(w).digest().readBigUInt64BE(0);
    v[Number(n % BigInt(DIM))] += (n >> 63n) === 0n ? 1 : -1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}
