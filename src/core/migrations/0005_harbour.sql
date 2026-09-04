-- Harbour: the island the reader sets out from at a scale. At most one per parent.
alter table islands add column harbour integer not null default 0;
create unique index islands_harbour_per_parent on islands(domain_id, coalesce(parent_id, 0)) where harbour = 1;
