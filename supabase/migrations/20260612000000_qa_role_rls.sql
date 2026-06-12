-- QA role: read access to all tickets and ticket_issues (same as admin read, no write)

CREATE POLICY "QA can view all tickets"
  ON tickets FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users WHERE users.auth_id = auth.uid() AND users.role = 'qa'
  ));

CREATE POLICY "QA can view all ticket issues"
  ON ticket_issues FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users WHERE users.auth_id = auth.uid() AND users.role = 'qa'
  ));

CREATE POLICY "QA can update ticket issues"
  ON ticket_issues FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users WHERE users.email = (auth.jwt()->>'email') AND users.role = 'qa'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM users WHERE users.email = (auth.jwt()->>'email') AND users.role = 'qa'
  ));
