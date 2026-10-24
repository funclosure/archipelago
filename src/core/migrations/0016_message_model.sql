-- The model that wrote a persona's reply (e.g. claude-opus-5-5, gemini-3.8-flash), null for the reader's words,
-- system lines, canned stub replies, and every reply written before this column existed.
alter table messages add column model text;
