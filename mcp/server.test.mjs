// End-to-end test: start the server over stdio with a temporary database and call every tool.
//   npm install && npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const dir = mkdtempSync(join(tmpdir(), "feedback-memory-"));
const env = { ...process.env, FEEDBACK_MEMORY_DIR: dir };
delete env.OPENAI_API_KEY;

async function connect() {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL("./server.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")], env }));
  return client;
}
const call = async (c, name, args) => (await c.callTool({ name, arguments: args })).content[0].text;

test("store decisions, recall similar ones, rules, forget, persistence", async () => {
  let c = await connect();
  const tools = (await c.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(tools, ["add_rule", "forget", "list_memory", "recall_corrections", "record_decision"]);

  assert.match(await call(c, "recall_corrections", { task: "Reply to: do you ship to Canada?" }), /Nothing stored yet/);
  assert.match(await call(c, "record_decision", { task: "Reply to: do you ship to Canada? love the lavender candle", decision: "edit",
    draft: "Yes!!! Super fast shipping!!", corrected_text: "We do! Canada usually takes 5-7 days.", reason: "don't promise speed" }), /Stored edited/);
  assert.match(await call(c, "record_decision", { task: "Reply to: can you gift wrap the vanilla set?", decision: "reject", reason: "we don't gift wrap" }), /Stored rejected/);
  assert.match(await call(c, "record_decision", { task: "Reply to: is the cedar candle back?", decision: "approve" }), /not recalled later/);
  const err = await c.callTool({ name: "record_decision", arguments: { task: "x", decision: "edit" } });
  assert.equal(err.isError, true);

  const recall = await call(c, "recall_corrections", { task: "Reply to: how long does shipping to Canada take?" });
  assert.match(recall, /5-7 days/);
  assert.doesNotMatch(recall, /gift wrap/);

  assert.match(await call(c, "add_rule", { rule: "No exclamation marks in replies" }), /Saved rule/);
  assert.match(await call(c, "recall_corrections", { task: "anything at all" }), /Rules \(always follow\):\n- No exclamation marks/);

  const mem = await call(c, "list_memory", {});
  assert.match(mem, /1 approved, 1 edited, 1 rejected/);
  const ruleId = mem.match(/- ([0-9a-f-]{36})  No exclamation/)[1];
  assert.match(await call(c, "forget", { id: ruleId }), /Deleted rule/);
  await c.close();

  // The snapshot the plugin's hooks read: rules and the recallable decisions (not the plain approval).
  const snap = JSON.parse(readFileSync(join(dir, "snapshot.json"), "utf8"));
  assert.deepEqual(snap.rules, []);
  assert.deepEqual(snap.decisions.map((d) => d.rating).sort(), [-1, 0]);

  // A new process sees the same database.
  c = await connect();
  const again = await call(c, "list_memory", {});
  assert.match(again, /Rules:\n\(none\)/);
  assert.match(again, /1 edited/);
  await c.close();
  rmSync(dir, { recursive: true, force: true });
});

test("a blank key from a Claude Desktop bundle (unfilled placeholder) falls back to offline hashing", { timeout: 60_000 }, async () => {
  const d = mkdtempSync(join(tmpdir(), "feedback-memory-"));
  const c = new Client({ name: "test", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [new URL("./server.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")],
    env: { ...env, FEEDBACK_MEMORY_DIR: d, OPENAI_API_KEY: "${user_config.openai_api_key}" } }));
  assert.match(await call(c, "record_decision", { task: "Reply to: do you ship to Canada?", decision: "reject", reason: "we only ship in Korea" }), /Stored rejected/);
  assert.match(await call(c, "list_memory", {}), /embeddings: hash-v1/);
  await c.close();
  rmSync(d, { recursive: true, force: true });
});
