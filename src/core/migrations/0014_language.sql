-- The language of the reader's page (en, zh-TW), null until they choose or the page reports one. Every persona's
-- context names it, so a reply follows the page when the reader's own words give no clear sign.
alter table learner add column language text;
