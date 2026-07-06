-- Multi-operator access: lets a SuperAdmin grant a user (typically QA/agent roles)
-- visibility into operators beyond their single "home" operator (users.operator_id,
-- unchanged — still drives ticket agent_team attribution and stays each person's
-- default). This table is purely additive extra access on top of that.
CREATE TABLE IF NOT EXISTS public.user_operator_access (
  user_id      uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  operator_id  uuid        NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  granted_by   text,
  granted_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, operator_id)
);

CREATE INDEX IF NOT EXISTS user_operator_access_user_idx ON public.user_operator_access (user_id);

ALTER TABLE public.user_operator_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_manage_user_operator_access"
  ON public.user_operator_access
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
