-- Pointers: a persona's "sail to <island>" when the reader's words belong to another island. Unattached (message_id
-- null) until the route stores the reply that carries it, like an ask. `question` is the reader's message that prompted
-- it, carried to the other island's mentor; `why` is the persona's one line on what is there.
create table pointers (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  island_id integer not null references islands(id) on delete cascade,
  message_id integer references messages(id) on delete cascade,
  target_island_id integer not null references islands(id) on delete cascade,
  why text not null,
  question text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index pointers_island on pointers(island_id, id);
create trigger pointers_ai after insert on pointers begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger pointers_au after update on pointers begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
