-- The reader's images: attached to one reader message each (message_id null until the message that carries it is
-- stored), in order. `bytes` is null once the reader removed the image (`removed_at` set): a tombstone that keeps the
-- thread's order and lets the persona say the image is gone. Every write bumps the domain's version.
create table images (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  message_id integer references messages(id) on delete cascade,
  position integer not null default 0,
  media_type text not null check (media_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  bytes blob,
  removed_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  check ((bytes is null) = (removed_at is not null))
);
create index images_message on images(message_id, position);
create index images_domain on images(domain_id, id);
create trigger images_ai after insert on images begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger images_au after update on images begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger images_ad after delete on images begin
  update view_state set version = version + 1 where domain_id = old.domain_id;
end;
