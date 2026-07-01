// quiz-generate
// Drafts multiple-choice training questions from a Learn article, for the
// Onboarding quiz builder (SuperAdmin/admin-only UI). The admin reviews, edits,
// and approves the draft before any question is saved — this only produces a
// proposal, it never writes to the DB itself. Uses Anthropic structured outputs
// so the response is schema-valid JSON by construction.
//
// Source material is either the article's typed content, OR — when there's no
// substantial typed content but the article is a PDF upload — the PDF itself,
// passed as a `document` content block with a `url` source. Claude reads PDFs
// natively (text + layout together), so this needs no separate PDF-parsing
// library. DOCX/XLSX/PPTX uploads still need typed content; every file-only
// Learn article in this system today happens to be a PDF.
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const sb = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'options', 'correct_index', 'explanation'],
        properties: {
          question:      { type: 'string', description: 'the question text' },
          // Anthropic structured-outputs rejects minItems/maxItems other than 0 or 1 for
          // array schemas — "exactly 4" is enforced via the system prompt instead, with a
          // defensive filter below in case the model still returns a different count.
          options:       { type: 'array', items: { type: 'string' }, description: 'exactly 4 answer choices' },
          // minimum/maximum aren't supported on integer schemas either — enforced by
          // description + the defensive filter below instead.
          correct_index: { type: 'integer', description: 'index (0, 1, 2, or 3) of the correct option' },
          explanation:   { type: 'string', description: 'one or two sentences on why that answer is correct, shown to the agent after they answer' },
        },
      },
    },
  },
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    const body = await req.json().catch(() => ({}))
    const articleId: string = body.article_id
    const questionCount: number = Math.min(Math.max(parseInt(body.question_count) || 8, 1), 15)
    // Optional steer: whatever the admin has already typed for the quiz's title/
    // description. When present, questions are focused on that stated intent
    // instead of blindly covering the whole article end to end.
    const quizTitle: string = typeof body.quiz_title === 'string' ? body.quiz_title.trim() : ''
    const quizDescription: string = typeof body.quiz_description === 'string' ? body.quiz_description.trim() : ''
    if (!articleId) return json({ error: 'article_id is required' }, 400)

    const artRes = await fetch(`${SUPABASE_URL}/rest/v1/kb_articles?id=eq.${articleId}&select=title,content,file_url,file_type`, { headers: sb })
    if (!artRes.ok) return json({ error: 'Failed to load the source article' }, 500)
    const rows = await artRes.json()
    const article = rows?.[0]
    if (!article) return json({ error: 'Article not found' }, 404)

    const hasText = !!article.content && article.content.trim().length >= 200
    const isPdf = article.file_type === 'application/pdf' && !!article.file_url
    if (!hasText && !isPdf) {
      return json({ error: 'This article has no typed content and isn\'t a PDF — DOCX/XLSX/PPTX uploads aren\'t readable by the model yet. Write the quiz manually, or add written content to the article.' }, 422)
    }

    const focusLine = (quizTitle || quizDescription)
      ? ` The admin has framed this quiz as: ${quizTitle ? `titled "${quizTitle}"` : ''}${quizTitle && quizDescription ? ', ' : ''}${quizDescription ? `described as "${quizDescription}"` : ''}. Prioritize questions that test that stated focus specifically — don't just summarize the whole article if the focus is narrower than that. Everything you ask must still be verifiably grounded in the article content below; don't invent facts to match the focus.`
      : ''

    // Text content wins when both exist (cheaper, and it's whatever the admin
    // deliberately typed/pasted); otherwise hand Claude the PDF directly.
    const userContent: any[] = hasText
      ? [{ type: 'text', text: `ARTICLE TITLE: ${article.title}\n\nARTICLE CONTENT:\n${article.content}` }]
      : [
          { type: 'text', text: `ARTICLE TITLE: ${article.title}\n\nThe article's content is the attached PDF — read it directly.` },
          { type: 'document', source: { type: 'url', url: article.file_url } },
        ]

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 4000,
        system: `You are writing an agent-training quiz for a customer-service team at an iGaming/sports-betting company. Write ${questionCount} multiple-choice questions (4 options each, exactly one correct) that test whether a support agent actually understood and can apply the material — not trivia about wording. Cover the article's distinct points; don't cluster all questions on one section. Plausible-but-wrong distractors, not silly ones. Keep each question and option concise.${focusLine}`,
        messages: [{ role: 'user', content: userContent }],
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      }),
    })

    if (!aiRes.ok) return json({ error: `Anthropic API ${aiRes.status}`, body: (await aiRes.text()).slice(0, 800) }, 502)
    const d = await aiRes.json()
    if (d.stop_reason === 'refusal') return json({ error: 'The model declined to draft questions for this article. Try again or write manually.' }, 502)
    const block = d.content?.find((b: any) => b.type === 'text')
    let draft: any
    try {
      draft = JSON.parse(block?.text ?? '')
    } catch {
      return json({ error: 'Unexpected non-JSON response. Try again.' }, 502)
    }

    // Defensive: the schema can no longer enforce "exactly 4 options" (see SCHEMA
    // comment), so drop any malformed question rather than let a bad one into the editor.
    const questions = (draft.questions ?? []).filter((q: any) =>
      Array.isArray(q?.options) && q.options.length === 4 &&
      typeof q.correct_index === 'number' && q.correct_index >= 0 && q.correct_index <= 3)

    return json({ questions, usage: d.usage ?? null })
  } catch (err: unknown) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})
