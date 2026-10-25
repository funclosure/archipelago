-- Loose ends: what the reader found confusing, asked and left open, or means to come back to, on one island. Either
-- persona notes one with the reader's own words; either closes it with the words that cleared it up, or the reader
-- dismisses it. Both personas read the open ones, so the Keeper learns what the mentor saw and the other way round.
create table loose_ends (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  island_id integer not null references islands(id) on delete cascade,
  landmark_id integer references landmarks(id) on delete set null,
  kind text not null check (kind in ('confused', 'asked', 'later')),
  note text not null,
  evidence text not null,
  message_id integer references messages(id) on delete set null,
  author text not null check (author in ('judge', 'mentor')),
  closed_at text,
  closed_by text check (closed_by in ('judge', 'mentor', 'you')),
  closed_evidence text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index loose_ends_island on loose_ends(island_id, id);
create trigger loose_ends_ai after insert on loose_ends begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger loose_ends_au after update on loose_ends begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
