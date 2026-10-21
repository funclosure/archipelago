-- The angle becomes the domain's description: the reader's own words on what they want to chart and why. A domain
-- made from a description alone starts under a provisional name taken from it (provisional = 1) until the
-- cartographer names it in its first sketch and the reader approves.
alter table domains rename column angle to description;
alter table domains add column provisional integer not null default 0;
