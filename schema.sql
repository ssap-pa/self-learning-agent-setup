-- Learning database for an AI agent that learns from your approvals.
-- Postgres 15+ with pgvector (Supabase works as is). MIT License.
-- Keep this schema private: don't expose it through your public API.
--
-- Embedding size: 1536 (OpenAI text-embedding-3-small). If you use another
-- model, change every vector(1536) below.

create extension if not exists vector;
create schema if not exists agent_learning;

-- One row per draft the agent produced for a task.
create table if not exists agent_learning.runs (
  id uuid primary key default gen_random_uuid(),
  goal text not null,                -- the standing goal, e.g. "reply to Instagram comments"
  task text not null,                -- this specific job, e.g. the comment being answered
  output text,                       -- the draft shown for approval (or the edited final text)
  status text not null default 'running'
    check (status in ('running', 'approved', 'edited', 'rejected', 'failed')),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Every approve (+1), edit (0) and reject (-1), linked to the run it judges.
create table if not exists agent_learning.feedback (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references agent_learning.runs(id) on delete cascade,
  rating smallint not null check (rating between -1 and 1),
  correction text,                   -- edits: the corrected final text
  reason text,                       -- one line on why ("too formal", "wrong price")
  situation text not null,           -- copy of runs.task: what the feedback was given on
  source text not null default 'user',
  event_key text unique,             -- idempotency key, e.g. a button callback id
  situation_embedding vector(1536),  -- finds feedback from similar situations
  reason_embedding vector(1536),     -- finds repeated reasons (rule candidates)
  created_at timestamptz not null default now(),
  check (rating <> 0 or correction is not null)
);

-- Rules: always applied once active.
create table if not exists agent_learning.rules (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  status text not null default 'candidate'
    check (status in ('candidate', 'active', 'retired')),
  evidence jsonb not null default '[]'::jsonb,  -- feedback ids behind the rule
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index if not exists feedback_run_idx on agent_learning.feedback (run_id);
create index if not exists rules_status_idx on agent_learning.rules (status);
create index if not exists feedback_situation_hnsw on agent_learning.feedback
  using hnsw (situation_embedding vector_cosine_ops);

-- Past feedback from situations similar to a new task. A plain approval with no
-- note carries no lesson, so only edits, rejects and approvals with a reason come back.
create or replace function agent_learning.match_feedback(
  query_embedding vector(1536),
  match_count int default 5,
  min_similarity double precision default 0.3
) returns table (
  id uuid, run_id uuid, rating smallint, correction text, reason text, situation text,
  similarity double precision, created_at timestamptz
)
language sql stable as $$
  select f.id, f.run_id, f.rating, f.correction, f.reason, f.situation,
         1 - (f.situation_embedding <=> query_embedding) as similarity,
         f.created_at
  from agent_learning.feedback f
  where f.situation_embedding is not null
    and (f.rating <= 0 or f.reason is not null)
    and 1 - (f.situation_embedding <=> query_embedding) >= min_similarity
  order by f.situation_embedding <=> query_embedding
  limit match_count;
$$;
