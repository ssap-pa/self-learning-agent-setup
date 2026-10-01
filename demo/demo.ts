// One-minute demo: an in-memory Postgres (PGlite + pgvector), a made-up candle shop,
// three days of feedback, then what the agent reads before its next draft.
//   npm install && npm run demo
// Uses the offline word-hashing embedder, so "similar" means shared words here.
// Set EMBED=openai and OPENAI_API_KEY to see real semantic matching.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { hashingEmbed, Loop, openaiEmbed } from "./loop.js";

const db = await PGlite.create({ extensions: { vector } });
await db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
const loop = new Loop(db, process.env.EMBED === "openai" ? openaiEmbed : hashingEmbed);
const GOAL = "Reply to customer comments";

const show = (s: string) => console.log(s.split("\n").map((l) => "         " + l).join("\n"));

console.log('\nDay 1  comment: "Do you ship to Canada? Love the lavender candle"');
console.log('       agent drafted: "Yes we do!!! Super fast shipping everywhere!!"');
const r1 = await loop.startRun(GOAL, "Do you ship to Canada? Love the lavender candle", "Yes we do!!! Super fast shipping everywhere!!");
await loop.recordFeedback(r1, 0, { correction: "We do! Canada usually takes 5-7 days.", reason: "don't promise speed, give the real shipping time" });
console.log('       you edited it to: "We do! Canada usually takes 5-7 days."  (why: don\'t promise speed, give the real shipping time)');

console.log('\nDay 2  comment: "Can you gift wrap the vanilla set for my mom?"');
console.log('       agent drafted: "Of course!! We gift wrap everything for free!"');
const r2 = await loop.startRun(GOAL, "Can you gift wrap the vanilla set for my mom?", "Of course!! We gift wrap everything for free!");
await loop.recordFeedback(r2, -1, { reason: "we don't gift wrap, offer the gift note instead" });
console.log("       you rejected it  (why: we don't gift wrap, offer the gift note instead)");

console.log('\nDay 2  comment: "Is the cedar candle back in stock?"');
const r3 = await loop.startRun(GOAL, "Is the cedar candle back in stock?", "Yes, it's back!");
await loop.recordFeedback(r3, 1);
console.log("       you approved the draft as is (stored, but there's no lesson in it, so it won't be retrieved)");

for (const task of ["How long does shipping to Canada take for the lavender set?", "Could you gift wrap a candle for a birthday?", "What wax do you use?"]) {
  console.log(`\nDay 3  new comment: "${task}"`);
  console.log("       before drafting, the agent reads:");
  show((await loop.contextFor(task)) || "(nothing yet: no feedback on anything similar)");
}

console.log("\nDecisions stored this week:", await loop.stats(), " (1 = approved, 0 = edited, -1 = rejected)\n");
