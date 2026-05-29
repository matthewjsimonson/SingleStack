-- ============================================================================
-- documents — the RAG corpus (the "what agents read").
-- Plain English: one row per source document an agent can draw on — external
-- material, an uploaded file, or a snapshot of a record so an agent can cite
-- the record itself. Holds the full text plus where it came from. The text is
-- split into document_chunks (next migration) for retrieval.
-- ============================================================================

create extension if not exists vector;  -- pgvector, for embedding similarity search

create table documents (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  created_at timestamptz not null default now(),

  source_id  uuid references sources (id) on delete set null,  -- optional originating source
  title      text,
  uri        text,        -- where it came from (url / path), optional
  doc_type   text,        -- e.g. 'external', 'upload', 'record_snapshot'
  content    text,        -- full document text
  metadata   jsonb
);

comment on table documents is 'RAG corpus: source documents agents read (external material, uploads, record snapshots). Split into document_chunks for retrieval.';

create index documents_org_id_idx on documents (org_id);
create index documents_source_id_idx on documents (source_id);

alter table documents enable row level security;

create policy documents_org_isolation on documents
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
