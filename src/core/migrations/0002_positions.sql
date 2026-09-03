-- Fixed map positions in a 1000 x 1000 world per scale. Null means the page has not placed the island yet.
alter table islands add column x real;
alter table islands add column y real;
