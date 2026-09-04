-- Landmarks: the 4–6 key concepts on an island. Dark until the judge lights one from a reader answer.
create table landmarks (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  island_id integer not null references islands(id) on delete cascade,
  slug text not null,
  name text not null,
  sort_order integer not null default 0,
  unlocked_at text,
  evidence text,
  message_id integer references messages(id) on delete set null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (island_id, slug)
);
create index landmarks_island on landmarks(island_id, sort_order, id);

create trigger landmarks_ai after insert on landmarks begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger landmarks_au after update on landmarks begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger landmarks_ad after delete on landmarks begin
  update view_state set version = version + 1 where domain_id = old.domain_id;
end;
