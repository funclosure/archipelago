-- Board cards: the island's whiteboard. Both sides write; creation order is the order.
create table board_cards (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  island_id integer not null references islands(id) on delete cascade,
  kind text not null check (kind in ('diagram', 'note', 'code')),
  title text not null,
  body text not null,
  lang text,
  author text not null check (author in ('you', 'judge')),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index board_cards_island on board_cards(island_id, id);
create trigger board_cards_ai after insert on board_cards begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger board_cards_au after update on board_cards begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger board_cards_ad after delete on board_cards begin
  update view_state set version = version + 1 where domain_id = old.domain_id;
end;
