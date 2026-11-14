-- foreign_keys: off
-- The mentor's guide thread: one per domain, not tied to an island, that asks where the reader stands and points them
-- at an island to start on. The marker above makes the runner switch foreign keys off around this file: messages and
-- pointers are rebuilt, and every row that references a message keeps its id.

-- messages: a fourth mode. island_id may be null in the cartographer's top-scale thread and in the guide thread.
create table messages_new (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  island_id integer references islands(id) on delete cascade,
  role text not null check (role in ('you', 'judge', 'mentor', 'cartographer')),
  kind text not null check (kind in ('text', 'reef_proposal', 'system')),
  body text not null,
  mode text not null default 'judge' check (mode in ('judge', 'mentor', 'cartographer', 'guide')),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  model text,
  check (island_id is not null or mode in ('cartographer', 'guide'))
);
insert into messages_new (id, domain_id, island_id, role, kind, body, mode, created_at, model)
  select id, domain_id, island_id, role, kind, body, mode, created_at, model from messages;
delete from sqlite_sequence where name = 'messages_new';
insert into sqlite_sequence (name, seq) select 'messages_new', seq from sqlite_sequence where name = 'messages';
drop table messages;
alter table messages_new rename to messages;
create index messages_island_mode on messages(island_id, mode, id);
create index messages_domain_mode on messages(domain_id, mode, id);
create trigger messages_ai after insert on messages begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger messages_au after update on messages begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;

-- pointers: island_id is null for the guide's (it points from the whole domain), and `lens` is the one it suggests
-- sailing in (null: the reader's own lens, as the island personas' pointers always were).
create table pointers_new (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  island_id integer references islands(id) on delete cascade,
  message_id integer references messages(id) on delete cascade,
  target_island_id integer not null references islands(id) on delete cascade,
  why text not null,
  question text,
  lens text check (lens in ('judge', 'mentor')),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
insert into pointers_new (id, domain_id, island_id, message_id, target_island_id, why, question, created_at)
  select id, domain_id, island_id, message_id, target_island_id, why, question, created_at from pointers;
delete from sqlite_sequence where name = 'pointers_new';
insert into sqlite_sequence (name, seq) select 'pointers_new', seq from sqlite_sequence where name = 'pointers';
drop table pointers;
alter table pointers_new rename to pointers;
create index pointers_island on pointers(island_id, id);
create index pointers_domain on pointers(domain_id, id);
create trigger pointers_ai after insert on pointers begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger pointers_au after update on pointers begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
