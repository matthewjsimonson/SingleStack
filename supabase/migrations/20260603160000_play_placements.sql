-- ============================================================================
-- play_placements — Phase 3: where a play lives in the product.
-- A play is placed onto a SURFACE (competitor home page, campaign record, content
-- brief, …). The surface registry itself lives in code (lib/surfaces.ts) — it's
-- product-defined, not user-editable — so a placement is just (play, surface_key).
-- Suggestions + guardrails (which surface a play may go on) are computed from the
-- play's target_type vs the surface's context. Phase 4 renders placed plays inline
-- on their surfaces as runnable elements.
-- ============================================================================

create table play_placements (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  created_at   timestamptz not null default now(),
  play_id      uuid not null references plays (id) on delete cascade,
  surface_key  text not null,
  unique (play_id, surface_key)
);

comment on table play_placements is 'Places a play onto a product surface (surface_key resolves to lib/surfaces.ts). Guardrails/suggestions are computed app-side from play.target_type vs the surface context.';

create index play_placements_org_idx on play_placements (org_id);
create index play_placements_surface_idx on play_placements (surface_key);

alter table play_placements enable row level security;
create policy play_placements_org_isolation on play_placements
  for all using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());
