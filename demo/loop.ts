// The core of the loop: store every decision, pull feedback from similar past tasks
// into the next prompt. MIT License.
//
//   const lr = new Loop(db);                       // pg.Pool, pg.Client or PGlite
//   const context = await lr.contextFor(task);     // put this above your drafting prompt
//   const runId = await lr.startRun(goal, task, draft);
//   await lr.recordFeedback(runId, 0, { correction: "the edited text", reason: "too formal" });
import { createHash } from "node:crypto";

export const EMBED_DIM = 1536;
export type Embed = (text: string) => Promise<number[]>;
export interface Db { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }
export type Rating = -1 | 0 | 1;

// Offline embedder for the demo: hashes words into a vector, so it only matches
// shared words, not meaning. Use openaiEmbed (or any model) for real retrieval.
const STOP = new Set("a an and are as at be but by can do does for from how i in is it me my of on or our so that the this to us we what when will with you your".split(" "));
export const hashingEmbed: Embed = async (text) => {
  const vec = new Array<number>(EMBED_DIM).fill(0);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []) {
    if (STOP.has(word)) continue;
    const n = createHash("sha256").update(word).digest().readBigUInt64BE(0);
    vec[Number(n % BigInt(EMBED_DIM))] += (n >> 63n) === 0n ? 1 : -1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
};

export const openaiEmbed: Embed = async (text) => {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 8000) }),
  });
  if (!res.ok) throw new Error(`openai embeddings: HTTP ${res.status}`);
  return (await res.json()).data[0].embedding;
};

const vec = (v: number[]) => "[" + v.map((x) => Number(x.toPrecision(7))).join(",") + "]";
const STATUS = { 1: "approved", 0: "edited", [-1]: "rejected" } as Record<number, string>;

export class Loop {
  constructor(public db: Db, public embed: Embed = hashingEmbed) {}

  async startRun(goal: string, task: string, output?: string): Promise<string> {
    const { rows } = await this.db.query(
      "insert into agent_learning.runs (goal, task, output) values ($1, $2, $3) returning id", [goal, task, output ?? null]);
    return String(rows[0].id);
  }

  /** Store one decision. Returns null if eventKey was already stored (a retried button tap). */
  async recordFeedback(runId: string, rating: Rating, o: { correction?: string; reason?: string; eventKey?: string } = {}) {
    if (rating === 0 && !o.correction) throw new Error("an edit needs the corrected text");
    const { rows: [run] } = await this.db.query("select task from agent_learning.runs where id = $1", [runId]);
    if (!run) throw new Error(`run ${runId} not found`);
    const { rows } = await this.db.query(
      `insert into agent_learning.feedback (run_id, rating, correction, reason, situation, event_key, situation_embedding)
       values ($1, $2, $3, $4, $5, $6, $7::vector) on conflict (event_key) do nothing returning id`,
      [runId, rating, o.correction ?? null, o.reason ?? null, run.task, o.eventKey ?? null, vec(await this.embed(run.task))]);
    if (!rows[0]) return null;
    await this.db.query("update agent_learning.runs set status = $1, finished_at = now(), output = coalesce($2, output) where id = $3",
      [STATUS[rating], o.correction ?? null, runId]);
    return String(rows[0].id);
  }

  /** What the agent should read before drafting: active rules + feedback from similar tasks. */
  async contextFor(task: string, k = 5, minSimilarity = 0.3): Promise<string> {
    const lines: string[] = [];
    const { rows: rules } = await this.db.query("select title from agent_learning.rules where status = 'active' order by created_at");
    if (rules.length) lines.push("Rules (always follow):", ...rules.map((r) => `- ${r.title}`));
    const { rows: past } = await this.db.query("select * from agent_learning.match_feedback($1::vector, $2, $3)",
      [vec(await this.embed(task)), k, minSimilarity]);
    if (past.length) {
      if (lines.length) lines.push("");
      lines.push("Feedback on similar past tasks (most similar first):");
      for (const f of past) {
        const why = f.reason ? ` (why: ${f.reason})` : "";
        const verdict = Number(f.rating) === 0 ? `edited to: "${f.correction}"${why}` : Number(f.rating) < 0 ? `rejected${why}` : `approved (note: ${f.reason})`;
        lines.push(`- task: "${f.situation}" -> ${verdict}`);
      }
    }
    return lines.join("\n");
  }

  /** If you've been tapping buttons and this is all zeros, the loop is broken. */
  async stats(days = 7): Promise<Record<number, number>> {
    const { rows } = await this.db.query(
      "select rating, count(*)::int as n from agent_learning.feedback where created_at > now() - make_interval(days => $1) group by rating", [days]);
    return Object.fromEntries(rows.map((r) => [Number(r.rating), Number(r.n)]));
  }
}
