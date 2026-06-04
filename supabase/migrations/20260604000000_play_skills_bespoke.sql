-- Play skills become BESPOKE.
--
-- Until now a play_skill was just a reference (skill_id) to a shared library
-- skill, and the UI's "play-specific instruction" actually rewrote that library
-- skill's instructions GLOBALLY — so play skills were neither play-specific nor
-- safe to edit. A play skill is the place to say "how THIS agent does THIS play
-- well," which is inherently bespoke.
--
-- So a play_skill now carries its own name + instructions, authored inline for
-- one (play, agent) pair and never touching the skills library. skill_id stays
-- (now optional) only as provenance for any legacy library-linked rows.
alter table play_skills add column if not exists name         text;
alter table play_skills add column if not exists instructions text;
alter table play_skills alter column skill_id drop not null;

comment on column play_skills.name is
  'Bespoke play-skill name, scoped to this (play, agent). NULL only for legacy library-linked rows.';
comment on column play_skills.instructions is
  'Bespoke instruction for how this agent applies this skill in this play. Authored inline; never touches the skills library.';
comment on table play_skills is
  'A skill layered onto one agent within one play — bespoke name + instructions, on top of that agent''s cornerstone skills, scoped to the play.';
