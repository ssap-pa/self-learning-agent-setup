# Prompts

Paste these into Claude Code or Codex inside your project folder. Answer its questions; read every file it writes.

## Knowledge layer

```
Check this project's path. Propose a structure for storing the brand
information that should shape all my content. Then tell me everything you
currently know about my business and customers so I can correct it.
Product details like prices will come from my site's database.
```

```
Create the brand folder. Ask me one question at a time about things that
rarely change: my story, customers, voice, humor limits, what I will and
won't share publicly, and objections I hear. Save each answer to the right
file.
```

```
Inside the brand folder, create an AGENTS.md that tells you which brand
file to read for which kind of task. In the root AGENTS.md, add only a
short pointer to it.
```

```
Connect my site's database for changing data like prices, stock, and
schedules. Then verify by listing my current products.
```

```
Build a RAG system for my products. Embed my course content and also store
the original text. Run embedding in a Supabase Edge Function and keep the
API key as a Supabase secret. Tell me the table names so I can check them.
```

## Learning loop

```
/goal Store my feedback and your work results as learning data in my
Supabase database, and evolve this into a self-improving system that keeps
raising performance on whatever goals I give you.
```

```
Explain your promotion criteria: how feedback and results become candidate
rules, how they're compared, and when a rule is promoted or dropped.
```

```
Add vector search over stored feedback so that past feedback from similar
situations is retrieved and applied to new drafts.
```

```
When someone comments on my post or replies to my comment, send me a reply
draft on Telegram in real time with Approve, Reject, and Edit buttons.
Record every button decision in the learning database.
```

```
Are my approvals, rejections, and edits being stored in the learning DB?
If not, why not? Fix the root cause in code.
```

---

From *Just Say "Do It"* (https://payhip.com/b/xmZvu). Full free field guide: https://payhip.com/b/QHgfJ
