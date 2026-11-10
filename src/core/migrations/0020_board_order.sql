-- Board cards: the reader's own order. `position` is null until the reader first moves a card on that board; a
-- card with none sorts by its id, so new cards land at the end and an untouched board keeps creation order.
alter table board_cards add column position integer;
