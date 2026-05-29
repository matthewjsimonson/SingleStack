-- ============================================================================
-- match_document_chunks — nearest-neighbor retrieval for RAG.
-- Plain English: given a query embedding, return the most similar chunks by
-- cosine distance. This is the retrieval half of RAG — an agent embeds its
-- question, calls this, and feeds the top chunks to Claude as context.
--
-- SECURITY INVOKER (the default): the function runs as the caller, so the RLS
-- policies on document_chunks and documents apply — results are automatically
-- fenced to the caller's org. No org_id parameter needed.
-- ============================================================================

create or replace function public.match_document_chunks(
  query_embedding vector(1536),
  match_count integer default 6
)
returns table (
  chunk_id       uuid,
  document_id    uuid,
  document_title text,
  content        text,
  similarity     double precision   -- 1 - cosine_distance (1.0 = identical)
)
language sql
stable
as $$
  select
    dc.id,
    dc.document_id,
    d.title,
    dc.content,
    1 - (dc.embedding <=> query_embedding) as similarity
  from document_chunks dc
  join documents d on d.id = dc.document_id
  where dc.embedding is not null
  order by dc.embedding <=> query_embedding
  limit greatest(match_count, 1)
$$;

comment on function public.match_document_chunks(vector, integer) is
  'RAG retrieval: returns the match_count chunks nearest the query embedding (cosine). Runs as caller (SECURITY INVOKER), so RLS scopes results to the caller''s org.';

-- Callable by the API roles (PostgREST exposes it as an RPC). Postgres already
-- grants EXECUTE to PUBLIC by default; this is explicit on Supabase and a no-op
-- elsewhere. Guarded so the migration also applies on a bare Postgres (e.g. CI)
-- where these roles don't exist.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('grant execute on function public.match_document_chunks(vector, integer) to %I', r);
    end if;
  end loop;
end
$$;
