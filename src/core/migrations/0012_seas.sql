-- Seas: names the reader writes on the water, grouping the islands of one scale the way they think about the domain.
-- parent_island_id is the scale (null = the domain's top scale). Only the reader writes, moves, or removes a sea.
create table seas (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  parent_island_id integer references islands(id) on delete cascade,
  name text not null,
  x real not null,
  y real not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
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
