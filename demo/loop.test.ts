// npm test: runs against an in-memory Postgres (PGlite + pgvector), no setup needed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { Loop } from "./loop.js";

let loop: Loop;
beforeEach(async () => {
  const db = await PGlite.create({ extensions: { vector } });
  await db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  loop = new Loop(db);
});

test("an edit comes back for a similar task", async () => {
  const run = await loop.startRun("reply", "Do you ship to Canada? Love the lavender candle", "Yes!!!");
  await loop.recordFeedback(run, 0, { correction: "We do! Canada takes 5-7 days.", reason: "give the real shipping time" });
  const ctx = await loop.contextFor("Can you ship the lavender candle to Canada?");
  assert.match(ctx, /edited to: "We do! Canada takes 5-7 days."/);
  assert.match(ctx, /give the real shipping time/);
});

test("an unrelated task gets nothing", async () => {
  const run = await loop.startRun("reply", "Do you ship to Canada?", "Yes");
  await loop.recordFeedback(run, -1, { reason: "never promise dates" });
  assert.equal(await loop.contextFor("What wax do you use?"), "");
});

test("a retried tap is stored once", async () => {
  const run = await loop.startRun("reply", "Is the cedar candle back?", "Yes");
  assert.ok(await loop.recordFeedback(run, 1, { eventKey: "tap-1" }));
  assert.equal(await loop.recordFeedback(run, 1, { eventKey: "tap-1" }), null);
  assert.deepEqual(await loop.stats(), { 1: 1 });
});

test("an edit needs the corrected text", async () => {
  const run = await loop.startRun("reply", "t", "d");
  await assert.rejects(loop.recordFeedback(run, 0), /needs the corrected text/);
});

test("active rules always come first", async () => {
  await loop.db.query("insert into agent_learning.rules (title, body, status) values ('Never invent a client story', 'Never invent a client story', 'active')");
  assert.match(await loop.contextFor("anything at all"), /^Rules \(always follow\):\n- Never invent a client story/);
});
