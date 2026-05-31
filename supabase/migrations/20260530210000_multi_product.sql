-- ============================================================================
-- Multi-product — make the intelligence spine product-aware end to end.
-- Plain English: a company can run multiple products with DIFFERENT buyers,
-- competitors, and messaging. Today signals already carry product_id, but
-- themes, bridges, objectives, sources, and competitors don't — so intelligence
-- piles together across products. This scopes the whole spine to an OPTIONAL
-- product:
--   • product_id NULL  = company-wide (a cross-product signal/theme/objective).
--   • product_id set   = belongs to that product line.
-- Single-product orgs never see a difference (everything stays NULL/company-wide);
-- multi-product orgs gain clean separation. Product line is also the natural
-- "territory" on the intelligence map.
--
-- Additive + nullable; on delete set null so deleting a product never destroys
-- the intelligence it informed (it just becomes company-wide).
-- ============================================================================

-- signals already has product_id (on delete cascade). We want deleting a product
-- to DEMOTE its signals to company-wide rather than vaporize them. But signals
-- carry a scope enum with a constraint: scope='product' REQUIRES product_id, and
-- scope='org' REQUIRES product_id IS NULL. So a plain FK SET NULL would violate
-- the constraint (scope='product' + product_id NULL). We need to move BOTH columns
-- together. A BEFORE-DELETE trigger on product_records does exactly that, then we
-- keep the FK as CASCADE-safe by clearing the rows first.
create or replace function public.demote_product_signals()
returns trigger language plpgsql as $$
begin
  -- product-scoped signals → company-wide (scope+product_id moved together)
  update signals set scope = 'org', product_id = null
   where product_id = old.id;
  return old;
end $$;

drop trigger if exists demote_signals_before_product_delete on product_records;
create trigger demote_signals_before_product_delete
  before delete on product_records
  for each row execute function public.demote_product_signals();

comment on function public.demote_product_signals() is 'When a product is deleted, demote its signals to company-wide (scope=org, product_id=null) together, honoring signals_scope_shape. Intelligence is never destroyed by removing a product.';

-- Themes — the core of the intelligence layer.
alter table signal_themes add column if not exists product_id uuid references product_records (id) on delete set null;
comment on column signal_themes.product_id is 'The product line this theme belongs to. NULL = company-wide / cross-product. Lets multi-product orgs separate intelligence by product (and is the map''s territory dimension).';
create index if not exists signal_themes_product_id_idx on signal_themes (product_id);

-- Objectives — strategy spine; an objective can be product-specific or company-wide.
alter table objectives add column if not exists product_id uuid references product_records (id) on delete set null;
comment on column objectives.product_id is 'The product this objective steers (NULL = company-wide).';
create index if not exists objectives_product_id_idx on objectives (product_id);

-- Sources — a source can feed a specific product (e.g. a product-specific Gong
-- folder) or the whole company.
alter table sources add column if not exists product_id uuid references product_records (id) on delete set null;
comment on column sources.product_id is 'The product this source primarily feeds (NULL = company-wide).';
create index if not exists sources_product_id_idx on sources (product_id);

-- Competitors — DIFFERENT products have different competitive sets.
alter table competitors add column if not exists product_id uuid references product_records (id) on delete set null;
comment on column competitors.product_id is 'The product this competitor competes with (NULL = company-wide). Different products, different competitive sets.';
create index if not exists competitors_product_id_idx on competitors (product_id);

-- Bridges link two themes; a bridge is product-scoped when both legs share a
-- product (derivable), but we store it explicitly so the map/engine can filter
-- cheaply and a cross-product bridge (legs in different products) stays NULL.
alter table bridges add column if not exists product_id uuid references product_records (id) on delete set null;
comment on column bridges.product_id is 'The product this bridge belongs to when both legs share one; NULL = cross-product or company-wide.';
create index if not exists bridges_product_id_idx on bridges (product_id);

-- Helper: a theme's evidence + confidence don't change, but the engine and views
-- now also need "which product is this theme for". Keep theme_confidence as-is;
-- product scoping is a filter layer on top, not a change to the math.
