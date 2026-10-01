# Self-Learning Agent Setup

A small, practical pattern for making an AI agent **remember your business** and **learn from every correction you give it**. No framework required: a folder of brand files, your existing database, and a feedback table.

I run a one-person education business in Korea this way. Agents (Claude Code, Codex) draft posts and replies. I approve, edit or reject them from my phone. Every decision goes into a database, and the next draft reads that history before it writes a word.

This repo has the minimal schema and the prompts. The full walkthrough is a free 23-page field guide (link at the bottom).

## Try it in one minute

**In your browser, no install:** https://ssap-pa.github.io/self-learning-agent-setup/ (Postgres + pgvector via PGlite and the all-MiniLM-L6-v2 embedding model via Transformers.js, all running in the tab, no API key).

![Browser demo: a gift-wrap question pulls in the earlier rejection; after storing an edit about unscented candles, a new unscented question pulls in that correction](img/demo.gif)

**Locally:**

```
git clone https://github.com/ssap-pa/self-learning-agent-setup
cd self-learning-agent-setup/demo
npm install
npm run demo
```

It starts an in-memory Postgres (PGlite + pgvector), feeds in three days of feedback for a made-up candle shop (one edit, one reject, one plain approval), then prints what the agent would read before its next drafts. No database or API key needed. `npm test` runs the tests the same way.

```
Day 3  new comment: "How long does shipping to Canada take for the lavender set?"
       before drafting, the agent reads:
         Feedback on similar past tasks (most similar first):
         - task: "Do you ship to Canada? Love the lavender candle" -> edited to: "We do! Canada usually takes 5-7 days." (why: don't promise speed, give the real shipping time)

Day 3  new comment: "Could you gift wrap a candle for a birthday?"
       before drafting, the agent reads:
         Feedback on similar past tasks (most similar first):
         - task: "Can you gift wrap the vanilla set for my mom?" -> rejected (why: we don't gift wrap, offer the gift note instead)

Day 3  new comment: "What wax do you use?"
       before drafting, the agent reads:
         (nothing yet: no feedback on anything similar)
```

The demo embeds text by hashing words, so "similar" here means shared words. Run `EMBED=openai OPENAI_API_KEY=... npm run demo` to use real embeddings, or point `Loop` at your own Postgres / Supabase with `pg`.

## The problem

Anyone can pay for the same model you use. What nobody else can buy is:

1. what your agent knows about **your** business, and
2. the record of every correction you've given it.

Most people give feedback in chat and lose it. The next session starts from zero, and you fix "stunning blooms" for the tenth time.

## Layer 1: the knowledge layer (what it knows)

![Knowledge layer](img/knowledge-layer.png)

| Type | Example | Where it lives |
|---|---|---|
| Constants | Brand, voice, customer, founder story | Markdown files in a `brand/` folder |
| Variables | Price, stock, seats, schedule | Your site's database, read live |
| Large knowledge | Lessons, ebooks, FAQs | Same database, embedded for search (RAG) |

Rules that matter:

- **Files for who you are, database for what's true right now.** Prices in a text file go stale, and the agent quotes last month's promo with confidence.
- **The agent can only say what your admin page stores.** "3 seats left" requires a seats field.
- **Enforce it in code.** A rule that only lives in `AGENTS.md` can be skipped. Programs that run on their own should call the database and search directly.

## Layer 2: the learning loop (how it improves)

![Learning loop](img/learning-loop.png)

1. **Store** every approve (+1), reject (−1) and edit (0, with the correction), linked to the run it judges.
2. **Generate candidates.** Repeated feedback becomes a *proposed* rule, not an active one.
3. **Score** with a rubric per goal.
4. **Compare** the candidate against current behavior.
5. **Promote or drop.**

Plus two details that made it actually work for me:

- **Rules vs. memory.** "Your tone sounds robotic" always applies (rule). "For funeral orders, no emojis" only applies when the situation matches (memory). Memories that keep repeating get promoted.
- **Search feedback by meaning.** Keyword search missed feedback phrased differently. Embeddings pull in corrections from *similar* situations.

And the human part: a Telegram bot sends each draft to my phone with **Approve / Reject / Edit** buttons, and the taps land in the learning database (not just the bot's log). Check that they actually do. Mine silently wasn't storing approvals at first.

## What's here

- [`schema.sql`](schema.sql): Postgres / Supabase tables (`runs`, `feedback` with situation and reason embeddings, `rules`) and `match_feedback()` for similarity search, with pgvector
- [`demo/loop.ts`](demo/loop.ts): the core loop in about 100 lines of TypeScript: store each decision, pull feedback from similar past tasks into the next prompt. Works with `pg` or PGlite
- [`demo/demo.ts`](demo/demo.ts) and [`demo/loop.test.ts`](demo/loop.test.ts): the one-minute demo and tests
- [`prompts.md`](prompts.md): the prompts I use with Claude Code / Codex to build and check each layer

## Start small

- Run one goal with low limits (mine: 1 post and up to 3 replies a day for two weeks).
- Keep approval on until there's nothing left to correct.
- Measure purchases or signups, not likes.

## More

- **Want the working code?** The Self-Learning Agent Kit has the full schema, Python and TypeScript versions of the library + CLI, a Telegram approval bot that stores every tap before publishing, rule proposals from repeated feedback, an end-to-end example and 26 tests ($39): https://payhip.com/b/grc25
- **Free field guide (23 pages, PDF):** the full walkthrough with a worked example and a 7-day plan: https://payhip.com/b/QHgfJ
- **The book:** *Just Say "Do It"*, an 11-step playbook for running a one-person business with AI agents (English edition of my Korean course): https://payhip.com/b/xmZvu
- **Want it set up around your business?** Done-for-you automation blueprint: https://payhip.com/b/BzSRC

---

Text and diagrams © 2026 AI SSAPABLE, shared under CC BY-NC 4.0. `schema.sql` and everything in `demo/` are MIT.
