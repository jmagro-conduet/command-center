-- ZD enrichment columns: resolution time, FCR, last player message + sentiment
alter table public.tickets
  add column if not exists zd_resolution_minutes   integer,
  add column if not exists zd_fcr                  boolean,
  add column if not exists zd_last_player_message  text,
  add column if not exists zd_player_sentiment     text,       -- COMPLIMENT | NEUTRAL | NEGATIVE
  add column if not exists zd_sentiment_confidence integer;
