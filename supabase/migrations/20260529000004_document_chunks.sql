-- ============================================================================
-- document_chunks — retrievable pieces of a document, with embeddings.
-- Plain English: each document is split into chunks; one row per chunk, with
-- its text and an embedding (a numeric vector). At query time an agent embeds
-- its question and finds the nearest chunks by cosine distance — that's RAG.
--
-- Embedding dimension is 1536 (the common OpenAI text-embedding-3-small size).
-- It's a starting default and easy to change while there is no data yet — swap
-- the number here (e.g. 1024 for Voyage, the Anthropic-recommended pairing) and
-- the index below before embedding anything.
-- ============================================================================

create table document_chunks (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  created_at  timestamptz not null default now(),

  document_id uuid not null references documents (id) on delete cascade,
  chunk_index integer not null,        -- order within the document
  content     text not null,           -- the chunk's text
  token_count integer,
  embedding   vector(1536),            -- similarity-search vector (dimension swappable; see header)

  unique (document_id, chunk_index)
);

comment on table document_chunks is 'Retrievable chunks of a document with embeddings. Nearest-neighbor search over embedding powers RAG. Vector dimension (1536) is a swappable default.';

create index document_chunks_org_id_idx on document_chunks (org_id);
create index document_chunks_document_id_idx on document_chunks (document_id);

-- Approximate nearest-neighbor index for cosine similarity (HNSW).
create index document_chunks_embedding_idx
  on document_chunks using hnsw (embedding vector_cosine_ops);

alter table document_chunks enable row level security;

create policy document_chunks_org_isolation on document_chunks
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
