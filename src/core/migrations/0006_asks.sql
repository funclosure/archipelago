-- Asks: a judge question with 2–4 options. Unattached (message_id null) until the route stores the reply that carries it.
create table asks (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  island_id integer not null references islands(id) on delete cascade,
  message_id integer references messages(id) on delete cascade,
  question text not null,
  options text not null,
  picked text,
  picked_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index asks_island on asks(island_id, id);
create trigger asks_ai after insert on asks begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger asks_au after update on asks begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
