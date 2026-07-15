-- Per-operator QA/UAT mode. While an operator is in QA mode (RSI right now),
-- duplicate placeholder ticket numbers ("0000", "000", etc.) are expected and
-- fine -- but every ticket-count metric across Submissions/Executive Summary/
-- Analytics/Leaderboard dedupes on tickets.ticket_number, which silently
-- collapses those distinct QA submissions into one, undercounting real volume.
--
-- Scoped intentionally: production operators default to false and are
-- completely unaffected -- ticket_number remains the sole counting key there,
-- matching a real, genuinely-unique external ticket ID. Only when this flag
-- is explicitly on does counting logic fall back to the tickets.id primary
-- key (the only way to tell apart rows that share a placeholder number).
alter table public.operators add column if not exists is_qa_mode boolean not null default false;

update public.operators set is_qa_mode = true where name = 'RSI';
