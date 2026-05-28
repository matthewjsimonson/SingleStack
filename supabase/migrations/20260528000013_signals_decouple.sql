-- ============================================================================
-- signals — decouple from a single record.
-- Plain English: a signal is an intelligence item — an observation from an
-- internal dataset or an external source. It exists on its own; it is not born
-- chained to one record. (Routing a signal toward a record change happens
-- through proposals, which cite signals as evidence.) So we relax the required
-- link to a GTM record: a signal MAY still note a related GTM record, but it no
-- longer has to.
-- ============================================================================

alter table signals
  alter column gtm_record_id drop not null;

comment on column signals.gtm_record_id is
  'Optional related GTM record. A signal is a standalone intelligence item; real routing to a record change happens via proposals that cite the signal.';
