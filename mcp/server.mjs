#!/usr/bin/env node
// feedback-memory: an MCP server that makes coding agents remember your approve / edit / reject
// decisions and read the closest past corrections before they draft. Local Postgres (PGlite +
// pgvector), one folder on your disk, nothing to host. MIT License.
//
//   claude mcp add feedback-memory -- npx -y github:ssap-pa/self-learning-agent-setup
//
// Env:
//   FEEDBACK_MEMORY_DIR  where the database lives (default ~/.feedback-memory)
//   OPENAI_API_KEY       if set, embeddings use text-embedding-3-small (matches by meaning);
//                        otherwise words are hashed offline (matches shared words only)
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const DIM = 1536;
const DIR = process.env.FEEDBACK_MEMORY_DIR || join(homedir(), ".feedback-memory");
const EMBEDDER = process.env.OPENAI_API_KEY ? "openai:text-embedding-3-small" : "hash-v1";
const GOAL = "work for the user";

const STOP = new Set("a an and are as at be but by can do does for from how i in is it me my of on or our so that the this to us we what when will with you your".split(" "));
function hashEmbed(text) {
  const v = new Array(DIM).fill(0);
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []) {
    if (STOP.has(w)) continue;
    const n = createHash("sha256").update(w).digest().readBigUInt64BE(0);
    v[Number(n % BigInt(DIM))] += (n >> 63n) === 0n ? 1 : -1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

async function openaiEmbed(text) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 8000) }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings: HTTP ${res.status}`);
  return (await res.json()).data[0].embedding;
}

const embed = async (text) => {
  const v = EMBEDDER === "hash-v1" ? hashEmbed(text) : await openaiEmbed(text);
  return "[" + v.map((x) => Number(x.toPrecision(7))).join(",") + "]";
};
// Word hashing scores lower than a real model for the same pair, so it gets a lower cutoff.
const MIN_SIM = EMBEDDER === "hash-v1" ? 0.3 : 0.45;

mkdirSync(DIR, { recursive: true });
const db = await PGlite.create(join(DIR, "pgdata"), { extensions: { vector } });
await db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
await db.exec("create table if not exists agent_learning.meta (key text primary key, value text not null)");

// Switching embedders (e.g. adding an OpenAI key later) re-embeds what's stored, so old and new vectors stay comparable.
const { rows: [meta] } = await db.query("select value from agent_learning.meta where key = 'embedder'");
if (meta?.value !== EMBEDDER) {
  const { rows } = await db.query("select id, situation from agent_learning.feedback");
  for (const r of rows) await db.query("update agent_learning.feedback set situation_embedding = $1::vector where id = $2", [await embed(r.situation), r.id]);
  await db.query("insert into agent_learning.meta (key, value) values ('embedder', $1) on conflict (key) do update set value = excluded.value", [EMBEDDER]);
}

const text = (s) => ({ content: [{ type: "text", text: s }] });
const RATING = { approve: 1, edit: 0, reject: -1 };
const STATUS = { 1: "approved", 0: "edited", [-1]: "rejected" };

const server = new McpServer({ name: "feedback-memory", version: "0.1.0" });

server.registerTool("recall_corrections", {
  title: "Recall the user's rules and past corrections",
  description: "Call this BEFORE you draft anything the user will review (posts, replies, emails, docs, commit messages, UI copy, code in a style they care about). Returns the user's standing rules and their past approve / edit / reject decisions on similar tasks, most similar first. Follow them.",
  inputSchema: { task: z.string().describe("What you are about to do, in one or two sentences (include the request or the text you are replying to)"), limit: z.number().int().min(1).max(20).optional() },
}, async ({ task, limit }) => {
  const lines = [];
  const { rows: rules } = await db.query("select id, title from agent_learning.rules where status = 'active' order by created_at");
  if (rules.length) lines.push("Rules (always follow):", ...rules.map((r) => `- ${r.title}`));
  const { rows } = await db.query("select * from agent_learning.match_feedback($1::vector, $2, $3)", [await embed(task), limit ?? 5, MIN_SIM]);
  if (rows.length) {
    if (lines.length) lines.push("");
    lines.push("The user's decisions on similar past tasks (most similar first):");
    for (const f of rows) {
      const why = f.reason ? ` (why: ${f.reason})` : "";
      const verdict = f.rating === 0 ? `edited to: "${f.correction}"${why}` : f.rating < 0 ? `rejected${why}` : `approved (note: ${f.reason})`;
      lines.push(`- task: "${f.situation}" -> ${verdict}   [similarity ${f.similarity.toFixed(2)}]`);
    }
  }
  return text(lines.length ? lines.join("\n") : "Nothing stored yet for anything similar. Draft normally, then record the user's decision with record_decision.");
});

server.registerTool("record_decision", {
  title: "Record the user's approve / edit / reject",
  description: "Call this right AFTER the user approves, edits or rejects something you drafted. Pass the user's reason in one line when they give one: the reason is what makes the next draft better. For an edit, pass the final text the user wanted.",
  inputSchema: {
    task: z.string().describe("The task the draft was for (same wording you would pass to recall_corrections)"),
    decision: z.enum(["approve", "edit", "reject"]),
    draft: z.string().optional().describe("What you had drafted"),
    corrected_text: z.string().optional().describe("For edits: the final text the user wanted"),
    reason: z.string().optional().describe("The user's reason, one line, in their words"),
  },
}, async ({ task, decision, draft, corrected_text, reason }) => {
  const rating = RATING[decision];
  if (rating === 0 && !corrected_text) return { ...text("An edit needs corrected_text (the final text the user wanted)."), isError: true };
  const { rows: [run] } = await db.query(
    "insert into agent_learning.runs (goal, task, output, status, finished_at) values ($1, $2, $3, $4, now()) returning id",
    [GOAL, task, corrected_text ?? draft ?? null, STATUS[rating]]);
  const { rows: [fb] } = await db.query(
    `insert into agent_learning.feedback (run_id, rating, correction, reason, situation, source, situation_embedding)
     values ($1, $2, $3, $4, $5, 'mcp', $6::vector) returning id`,
    [run.id, rating, corrected_text ?? null, reason ?? null, task, await embed(task)]);
  const note = rating === 1 && !reason ? " A plain approval is kept but not recalled later (it carries no lesson); add a reason if there was one." : "";
  return text(`Stored ${STATUS[rating]} decision ${fb.id}.${note}`);
});

server.registerTool("add_rule", {
  title: "Save a standing rule",
  description: "When the user states a preference that should ALWAYS apply (\"never use exclamation marks\", \"prices only from the database\"), save it as a rule. Rules come back first in every recall_corrections.",
  inputSchema: { rule: z.string().describe("The rule, as one short sentence") },
}, async ({ rule }) => {
  const { rows: [r] } = await db.query(
    "insert into agent_learning.rules (title, body, status, decided_at) values ($1, $1, 'active', now()) returning id", [rule]);
  return text(`Saved rule ${r.id}.`);
});

server.registerTool("list_memory", {
  title: "Show what's stored",
  description: "Show the active rules, the most recent decisions with their ids, and how many approve / edit / reject decisions were stored in the last 7 days. Use it when the user asks what you remember, or to check that decisions are actually being stored.",
  inputSchema: { recent: z.number().int().min(1).max(50).optional() },
}, async ({ recent }) => {
  const { rows: rules } = await db.query("select id, title from agent_learning.rules where status = 'active' order by created_at");
  const { rows: last } = await db.query("select id, rating, situation, correction, reason, created_at from agent_learning.feedback order by created_at desc limit $1", [recent ?? 10]);
  const { rows: counts } = await db.query("select rating, count(*)::int as n from agent_learning.feedback where created_at > now() - interval '7 days' group by rating");
  const c = Object.fromEntries(counts.map((r) => [r.rating, r.n]));
  return text([
    `Database: ${join(DIR, "pgdata")} (embeddings: ${EMBEDDER})`,
    `Last 7 days: ${c[1] ?? 0} approved, ${c[0] ?? 0} edited, ${c[-1] ?? 0} rejected`,
    "", "Rules:", ...(rules.length ? rules.map((r) => `- ${r.id}  ${r.title}`) : ["(none)"]),
    "", "Recent decisions:", ...(last.length ? last.map((f) => `- ${f.id}  ${STATUS[f.rating]}  "${f.situation.slice(0, 80)}"${f.reason ? `  why: ${f.reason}` : ""}`) : ["(none)"]),
  ].join("\n"));
});

server.registerTool("forget", {
  title: "Delete a rule or a decision",
  description: "Delete one rule or one stored decision by id (ids come from list_memory). Use when the user says a rule or a past correction no longer applies.",
  inputSchema: { id: z.string().uuid() },
}, async ({ id }) => {
  const r = await db.query("delete from agent_learning.rules where id = $1 returning id", [id]);
  const f = r.rows.length ? { rows: [] } : await db.query(
    "delete from agent_learning.runs where id = (select run_id from agent_learning.feedback where id = $1) returning id", [id]);
  return text(r.rows.length ? `Deleted rule ${id}.` : f.rows.length ? `Deleted decision ${id}.` : `Nothing found with id ${id}.`);
});

await server.connect(new StdioServerTransport());
