create table domains (
  id integer primary key autoincrement,
  slug text not null unique,
  name text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table islands (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  parent_id integer references islands(id) on delete cascade,
  slug text not null,
  name text not null,
  summary text,
  sort_order integer not null default 0,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (domain_id, slug)
);
create index islands_parent on islands (domain_id, parent_id, sort_order);

create table straits (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  from_island_id integer not null references islands(id) on delete cascade,
  to_island_id integer not null references islands(id) on delete cascade,
  name text,
  summary text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  check (from_island_id < to_island_id),
  unique (from_island_id, to_island_id)
);

create table sessions (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  started_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at text,
  summary text
);

create table verdicts (
  id integer primary key autoincrement,
  target_type text not null check (target_type in ('island', 'strait')),
  target_id integer not null,
  state text not null check (state in ('sandbar', 'settled', 'mountainous', 'reef')),
  confidence real not null check (confidence >= 0 and confidence <= 1),
  evidence text not null,
  rationale text,
  session_id integer references sessions(id) on delete set null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index verdicts_target on verdicts (target_type, target_id, id);

create table comments (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  target_type text not null check (target_type in ('island', 'strait', 'domain')),
  target_id integer not null,
  body text not null default '',
  kind text not null check (kind in ('note', 'probe_me', 'sail_closer', 'dispute')),
  read_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index comments_unread on comments (domain_id, read_at);

create table view_state (
  domain_id integer primary key references domains(id) on delete cascade,
  focus_island_id integer references islands(id) on delete set null,
  version integer not null default 0
);

-- Every domain gets a view_state row; every write bumps its version.
create trigger domains_ai after insert on domains begin
  insert into view_state (domain_id) values (new.id);
end;

create trigger islands_ai after insert on islands begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger islands_au after update on islands begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;

create trigger straits_ai after insert on straits begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger straits_au after update on straits begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;

create trigger verdicts_ai after insert on verdicts begin
  update view_state set version = version + 1 where domain_id = (
    case new.target_type
      when 'island' then (select domain_id from islands where id = new.target_id)
      else (select domain_id from straits where id = new.target_id)
    end
  );
end;

create trigger sessions_ai after insert on sessions begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger sessions_au after update on sessions begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;

create trigger comments_ai after insert on comments begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger comments_au after update on comments begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;

create trigger view_state_focus_au after update of focus_island_id on view_state begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
