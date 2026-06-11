-- Competitor grouping: a third tier. 'watching' = on the radar (signals
-- collected, no active battlecard motion) — keeps the matrix and feeds from
-- drowning as the tracked set grows. No CHECK existed on relationship; this
-- documents the contract.
comment on column competitors.relationship is 'direct | adjacent | watching — direct: head-on rivals (full battlecard motion); adjacent: partial overlap; watching: on the radar, signals only.';
