-- Onboarding quizzes — a sub-section of Learn where admins author agent-training
-- quizzes (optionally linked to a Learn article as the source material) and agents
-- take them, with attempts scored and recorded.
CREATE TABLE IF NOT EXISTS public.quizzes (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title               text        NOT NULL DEFAULT '',
  description         text        NOT NULL DEFAULT '',
  source_article_id   uuid        REFERENCES public.kb_articles(id) ON DELETE SET NULL,
  passing_score       int         NOT NULL DEFAULT 70,
  is_published        boolean     NOT NULL DEFAULT false,
  -- Global quizzes (operator_id null) are visible to every client; otherwise
  -- scoped to one operator — mirrors kb_articles.operator_id.
  operator_id         uuid        REFERENCES public.operators(id) ON DELETE CASCADE,
  created_by          text        NOT NULL DEFAULT '',
  updated_by          text        NOT NULL DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.quiz_questions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id        uuid        NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  question       text        NOT NULL DEFAULT '',
  options        jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- array of option strings
  correct_index  int         NOT NULL DEFAULT 0,            -- index into options
  explanation    text        NOT NULL DEFAULT '',           -- shown after answering
  sort_order     int         NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.quiz_attempts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id       uuid        NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user_name     text        NOT NULL DEFAULT '',
  user_email    text        NOT NULL DEFAULT '',
  score_pct     int         NOT NULL DEFAULT 0,
  passed        boolean     NOT NULL DEFAULT false,
  answers       jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- [{question_id, selected_index, correct}]
  completed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quiz_questions_quiz_idx ON public.quiz_questions (quiz_id, sort_order);
CREATE INDEX IF NOT EXISTS quiz_attempts_quiz_idx  ON public.quiz_attempts (quiz_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS quiz_attempts_user_idx  ON public.quiz_attempts (user_id, completed_at DESC);

ALTER TABLE public.quizzes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_attempts  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_manage_quizzes"        ON public.quizzes        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_manage_quiz_questions" ON public.quiz_questions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_manage_quiz_attempts"  ON public.quiz_attempts  FOR ALL TO authenticated USING (true) WITH CHECK (true);
