-- Suggested seas: the cartographer may propose seas in a sketch, and approving it writes them. A proposed sea has no
-- position yet, only the islands it was proposed for (anchor, a JSON array of slugs); the page places its name over
-- them once they are placed, then the sea is like any other. x and y become nullable, so the table is rebuilt.
create table seas_new (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  parent_island_id integer references islands(id) on delete cascade,
  name text not null,
  x real,
  y real,
  anchor text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  check ((x is null) = (y is null))
);
insert into seas_new (id, domain_id, parent_island_id, name, x, y, created_at, updated_at)
  select id, domain_id, parent_island_id, name, x, y, created_at, updated_at from seas;
delete from sqlite_sequence where name = 'seas_new';
insert into sqlite_sequence (name, seq) select 'seas_new', seq from sqlite_sequence where name = 'seas';
drop table seas;
alter table seas_new rename to seas;
create index seas_scale on seas(domain_id, parent_island_id, id);
create trigger seas_ai after insert on seas begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger seas_au after update on seas begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger seas_ad after delete on seas begin
  update view_state set version = version + 1 where domain_id = old.domain_id;
end;
