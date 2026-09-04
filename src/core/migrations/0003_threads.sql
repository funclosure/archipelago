-- One thread per island. Written by the judge (server) and read by the page and the cartographer.
create table messages (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  island_id integer not null references islands(id) on delete cascade,
  role text not null check (role in ('you', 'judge')),
  kind text not null check (kind in ('text', 'reef_proposal', 'system')),
  body text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index messages_island on messages(island_id, id);

create trigger messages_ai after insert on messages begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger messages_au after update on messages begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
