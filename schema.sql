-- Minimal learning database for an AI agent that learns from your approvals.
-- Postgres / Supabase with pgvector. Keep the schema private (not exposed to your public API).
-- MIT License.

create extension if not exists vector;
create schema if not exists agent_learning;

-- One row per goal or task the agent works on.
create table if not exists agent_learning.runs (
  id uuid primary key default gen_random_uuid(),
  goal text not null,
  status text not null default 'running',
  summary text,
  started_at timestamptz not null default now()
);

-- Every approve (+1), reject (-1) and edit (0 with a correction), linked to the run it judges.
-- embedding: search past feedback by meaning (1536 dims fits OpenAI's small embedding model).
create table if not exists agent_learning.feedback (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references agent_learning.runs(id),
  rating smallint not null check (rating between -1 and 1),
  correction text,
  source text not null default 'user',
  embedding vector(1536),
  created_at timestamptz not null default now()
);

-- Candidate, active and retired rules, with the evidence that promoted or dropped them.
create table if not exists agent_learning.rules (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  status text not null default 'candidate'
    check (status in ('candidate', 'active', 'retired')),
  evidence jsonb,
  created_at timestamptz not null default now()
);

create index if not exists feedback_run_idx on agent_learning.feedback (run_id);
create index if not exists rules_status_idx on agent_learning.rules (status);
