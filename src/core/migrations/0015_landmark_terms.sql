-- The words a reply uses for a landmark (JSON array of strings, null when none were given), so the page can mark
-- them in the conversation: in the reader's language, plus the English term where the field writes it in English.
alter table landmarks add column terms text;
