-- Deploy trigger: a harmless, idempotent marker whose only job is to give the
-- Supabase GitHub integration a new change on main, so it runs and applies all
-- pending Foundation migrations to the connected project.
comment on schema public is 'SingleStack — Foundation schema';
