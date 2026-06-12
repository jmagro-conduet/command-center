-- RPC: return issue counts for a batch of ticket IDs in one query.
-- Replaces the N/200 serial chunk loop in fetchTicketCompleteness.
-- SECURITY DEFINER is safe here — callers already hold operator-scoped ticket IDs.
CREATE OR REPLACE FUNCTION get_ticket_issue_counts(p_ticket_ids uuid[])
RETURNS TABLE(ticket_id uuid, cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ticket_id, count(*)::bigint AS cnt
  FROM ticket_issues
  WHERE ticket_id = ANY(p_ticket_ids)
  GROUP BY ticket_id;
$$;
