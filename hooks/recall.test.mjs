// Tests for the Claude Code plugin hook: what it adds at session start and per prompt, and that
// it never blocks or breaks a prompt.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { contextFor } from "./recall.mjs";

const snapshot = {
  version: 1,
  rules: ["No exclamation marks in replies"],
  decisions: [
    { rating: 0, situation: "Reply to: do you ship to Canada? love the lavender candle", correction: "We do! Canada usually takes 5-7 days.", reason: "don't promise speed" },
    { rating: -1, situation: "Reply to: can you gift wrap the vanilla set?", correction: null, reason: "we don't gift wrap" },
  ],
};

test("session start gives the standing rules and resets what the session has seen", () => {
  const out = contextFor({ hook_event_name: "SessionStart", source: "compact" }, snapshot, new Set(["x"]));
  assert.match(out.text, /standing rules/);
  assert.match(out.text, /- No exclamation marks in replies/);
  assert.equal(out.seen.size, 0);
  assert.equal(contextFor({ hook_event_name: "SessionStart" }, { ...snapshot, rules: [] }).text, "");
});

test("a prompt gets the similar past decision once per session, not the unrelated one", () => {
  const input = { hook_event_name: "UserPromptSubmit", prompt: "Draft a reply: how long does shipping to Canada take?" };
  const first = contextFor(input, snapshot, new Set());
  assert.match(first.text, /5-7 days/);
  assert.match(first.text, /why: don't promise speed/);
  assert.doesNotMatch(first.text, /gift wrap/);
  assert.equal(contextFor(input, snapshot, first.seen).text, "");
  assert.equal(contextFor({ hook_event_name: "UserPromptSubmit", prompt: "fix the failing build" }, snapshot).text, "");
});

const hook = fileURLToPath(new URL("./recall.mjs", import.meta.url));
const run = (dir, stdin) => spawnSync(process.execPath, [hook], { input: stdin, env: { ...process.env, FEEDBACK_MEMORY_DIR: dir }, encoding: "utf8" });

test("as a process: JSON for Claude Code, nothing when there's nothing to add, never a non-zero exit", () => {
  const dir = mkdtempSync(join(tmpdir(), "feedback-memory-hook-"));
  try {
    let r = run(dir, JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s1", prompt: "shipping to Canada?" }));
    assert.equal(r.status, 0);
    assert.equal(r.stdout, ""); // no snapshot yet

    writeFileSync(join(dir, "snapshot.json"), JSON.stringify(snapshot));
    r = run(dir, JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s1", prompt: "Reply to: how long does shipping to Canada take?" }));
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout).hookSpecificOutput;
    assert.equal(out.hookEventName, "UserPromptSubmit");
    assert.match(out.additionalContext, /5-7 days/);

    r = run(dir, JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s1", prompt: "Reply to: how long does shipping to Canada take?" }));
    assert.equal(r.stdout, ""); // already given in this session

    r = run(dir, JSON.stringify({ hook_event_name: "SessionStart", session_id: "s1", source: "compact" }));
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /No exclamation marks/);
    r = run(dir, JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s1", prompt: "Reply to: how long does shipping to Canada take?" }));
    assert.match(r.stdout, /5-7 days/); // after compaction it may be given again

    r = run(dir, "not json");
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("light stemming: 'shipping' finds a past 'do you ship' decision", async () => {
  const { stem } = await import("../mcp/hash-embed.mjs");
  assert.deepEqual(["shipping", "ships", "shipped", "replies", "edited", "candles", "wrapping"].map(stem), ["ship", "ship", "ship", "reply", "edit", "candle", "wrap"]);
  const out = contextFor({ hook_event_name: "UserPromptSubmit", prompt: "Shipping time to Canada?" }, snapshot, new Set());
  assert.match(out.text, /5-7 days/);
});
