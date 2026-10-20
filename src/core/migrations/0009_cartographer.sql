-- foreign_keys: off
-- The cartographer in the app. The marker above makes the runner switch foreign keys off around this file:
-- messages is rebuilt, and landmarks.message_id, landmarks.explored_message_id and asks.message_id keep their ids.

-- messages: a third mode and role. island_id may be null, meaning the domain's top scale, and only in the
-- cartographer's threads; the judge's and the mentor's always belong to an island.
create table messages_new (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  island_id integer references islands(id) on delete cascade,
  role text not null check (role in ('you', 'judge', 'mentor', 'cartographer')),
  kind text not null check (kind in ('text', 'reef_proposal', 'system')),
  body text not null,
  mode text not null default 'judge' check (mode in ('judge', 'mentor', 'cartographer')),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  check (island_id is not null or mode = 'cartographer')
);
insert into messages_new (id, domain_id, island_id, role, kind, body, mode, created_at)
  select id, domain_id, island_id, role, kind, body, mode, created_at from messages;
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

-- sketches: what the cartographer proposes at one scale (parent_island_id null = the top scale). Written to the
-- map only when the reader approves; at most one pending per scale.
create table sketches (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  parent_island_id integer references islands(id) on delete cascade,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'discarded', 'superseded')),
  message_id integer references messages(id) on delete set null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  decided_at text
);
create unique index sketches_one_pending on sketches(domain_id, coalesce(parent_island_id, 0)) where status = 'pending';
create trigger sketches_ai after insert on sketches begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger sketches_au after update on sketches begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
