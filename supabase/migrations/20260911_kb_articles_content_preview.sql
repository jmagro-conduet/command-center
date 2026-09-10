-- Learn's list view was fetching every article's FULL content on every
-- load just to build a 120-char preview snippet -- fine at ~13 articles,
-- noticeably slow now that Kustomer sync brought the corpus to ~160+
-- (including lengthy SOP bodies). A generated column gives the list view a
-- cheap, small field to select instead; full content is now fetched lazily,
-- only when an article is actually opened to read or edit.

alter table public.kb_articles
  add column if not exists content_preview text generated always as (left(content, 300)) stored;
