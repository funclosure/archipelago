-- foreign_keys: off
-- Mentor mode. The marker above makes the runner switch foreign keys off around this file: messages and
-- board_cards are rebuilt (new checks), and landmarks.message_id / asks.message_id must keep their ids.

-- messages: a third role, and a mode. Every existing row is the judge's thread.
create table messages_new (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  island_id integer not null references islands(id) on delete cascade,
  role text not null check (role in ('you', 'judge', 'mentor')),
  kind text not null check (kind in ('text', 'reef_proposal', 'system')),
  body text not null,
  mode text not null default 'judge' check (mode in ('judge', 'mentor')),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
insert into messages_new (id, domain_id, island_id, role, kind, body, mode, created_at)
  select id, domain_id, island_id, role, kind, body, 'judge', created_at from messages;
-- carry the id sequence, so a deleted message's id is never reused
delete from sqlite_sequence where name = 'messages_new';
insert into sqlite_sequence (name, seq) select 'messages_new', seq from sqlite_sequence where name = 'messages';
drop table messages;
alter table messages_new rename to messages;
create index messages_island_mode on messages(island_id, mode, id);
create trigger messages_ai after insert on messages begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;
create trigger messages_au after update on messages begin
  update view_state set version = version + 1 where domain_id = new.domain_id;
end;

-- landmarks: explored is its own mark. unlocked_at is untouched; the two never share a column.
alter table landmarks add column explored_at text;
alter table landmarks add column explored_evidence text;
alter table landmarks add column explored_message_id integer references messages(id) on delete set null;

-- board_cards: the mentor may author a card.
create table board_cards_new (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  island_id integer not null references islands(id) on delete cascade,
  kind text not null check (kind in ('diagram', 'note', 'code')),
  title text not null,
  body text not null,
  lang text,
  author text not null check (author in ('you', 'judge', 'mentor')),
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

-- learner: one row, the note the reader writes about themselves. Global, so its update bumps every domain.
create table learner (
  id integer primary key check (id = 1),
  note text not null default '',
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
insert into learner (id) values (1);
create trigger learner_au after update on learner begin
  update view_state set version = version + 1;
end;
