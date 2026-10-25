-- foreign_keys: off
-- Board cards: a fourth kind, `demo` (a persona's runnable HTML demo), and `forked_from`: the persona whose reply
-- the reader pinned the card from (null for a card written on the board). The kind check is new, so the table is rebuilt.
create table board_cards_new (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  island_id integer not null references islands(id) on delete cascade,
  kind text not null check (kind in ('diagram', 'note', 'code', 'demo')),
  title text not null,
  body text not null,
  lang text,
  author text not null check (author in ('you', 'judge', 'mentor')),
  forked_from text check (forked_from in ('judge', 'mentor')),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
insert into board_cards_new (id, domain_id, island_id, kind, title, body, lang, author, created_at, updated_at)
  select id, domain_id, island_id, kind, title, body, lang, author, created_at, updated_at from board_cards;
delete from sqlite_sequence where name = 'board_cards_new';
insert into sqlite_sequence (name, seq) select 'board_cards_new', seq from sqlite_sequence where name = 'board_cards';
drop table board_cards;
alter table board_cards_new rename to board_cards;
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
