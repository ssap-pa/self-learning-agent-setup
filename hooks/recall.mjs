#!/usr/bin/env node
// Claude Code plugin hook for feedback-memory, so your corrections apply even when Claude doesn't
// call recall_corrections:
//   SessionStart       -> your standing rules (again after /clear and after compaction)
//   UserPromptSubmit   -> your past decisions on tasks similar to this prompt, each once per session
// Reads snapshot.json, which the MCP server writes next to its database (the hook can't open the
// database while the server has it open). Matches by shared words, offline. Never blocks a prompt:
// on any problem it adds nothing.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { HASH_MIN_SIM, hashEmbed } from "../mcp/hash-embed.mjs";

const DIR = process.env.FEEDBACK_MEMORY_DIR || join(homedir(), ".feedback-memory");
const LIMIT = 3;

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const keyOf = (d) => `${d.rating}|${d.situation}|${d.correction ?? ""}|${d.reason ?? ""}`;

function decisionLine(d, similarity) {
  const why = d.reason ? ` (why: ${d.reason})` : "";
  const verdict = d.rating === 0 ? `edited to: "${d.correction}"${why}` : d.rating < 0 ? `rejected${why}` : `approved (note: ${d.reason})`;
  return `- task: "${d.situation}" -> ${verdict}   [similarity ${similarity.toFixed(2)}]`;
}

// Which decisions this session has already been given, so a long session doesn't repeat them.
function seenFile(sessionId) {
  const dir = join(DIR, "hook-sessions");
  mkdirSync(dir, { recursive: true });
  if (Math.random() < 0.05) { // now and then, drop state from sessions older than a week
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (Date.now() - statSync(p).mtimeMs > 7 * 864e5) rmSync(p, { force: true });
    }
  }
  return join(dir, `${String(sessionId).replace(/[^\w-]/g, "_")}.json`);
}

export function contextFor(input, snapshot, seen = new Set()) {
  if (input.hook_event_name === "SessionStart") {
    if (!snapshot.rules.length) return { text: "", seen: new Set() };
    return {
      text: ["feedback-memory: the user's standing rules. Follow them in everything you draft for this user.", ...snapshot.rules.map((r) => `- ${r}`)].join("\n"),
      seen: new Set(), // a fresh or compacted context: past decisions may be given again
    };
  }
  const prompt = (input.prompt ?? "").trim();
  if (!prompt) return { text: "", seen };
  const q = hashEmbed(prompt);
  const matches = snapshot.decisions
    .filter((d) => !seen.has(keyOf(d)))
    .map((d) => ({ d, similarity: dot(q, hashEmbed(d.situation)) }))
    .filter((m) => m.similarity >= HASH_MIN_SIM)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, LIMIT);
  if (!matches.length) return { text: "", seen };
  for (const m of matches) seen.add(keyOf(m.d));
  return {
    text: ["feedback-memory: the user's decisions on similar past tasks (most similar first). Apply them to this request.", ...matches.map((m) => decisionLine(m.d, m.similarity))].join("\n"),
    seen,
  };
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw || "{}");
  const snapPath = join(DIR, "snapshot.json");
  if (!existsSync(snapPath)) return; // nothing stored yet
  const snapshot = JSON.parse(readFileSync(snapPath, "utf8"));
  const file = seenFile(input.session_id ?? "no-session");
  const seen = new Set(existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : []);
  const out = contextFor(input, snapshot, seen);
  writeFileSync(file, JSON.stringify([...out.seen]));
  if (out.text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: out.text } }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {}).finally(() => process.exit(0));
}
