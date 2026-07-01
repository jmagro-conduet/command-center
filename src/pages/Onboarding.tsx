import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useOperator } from '../context/OperatorContext'

// Onboarding — sub-section of Learn where admins author agent-training quizzes
// (optionally linked to a Learn article as source material, with an AI-assist
// button to draft questions from that article's text) and agents take them,
// with attempts scored and recorded in quiz_attempts.

interface Quiz {
  id: string
  title: string
  description: string
  source_article_id: string | null
  passing_score: number
  is_published: boolean
  operator_id: string | null
  updated_at: string
}
interface Question {
  id: string
  question: string
  options: string[]
  correct_index: number
  explanation: string
}
interface Attempt {
  id: string
  quiz_id: string
  user_name: string
  user_email: string
  score_pct: number
  passed: boolean
  completed_at: string
}
interface ArticleOption { id: string; title: string; content: string }
type DraftQuestion = Question & { _key: string }
type View = 'list' | 'create' | 'edit' | 'take' | 'results'

let keySeq = 0
const newKey = () => `q${++keySeq}`
const emptyQuestion = (): DraftQuestion => ({ _key: newKey(), id: '', question: '', options: ['', '', '', ''], correct_index: 0, explanation: '' })

const inputStyle: React.CSSProperties = {
  border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 10,
  padding: '9px 12px', fontSize: 13, color: '#000',
  outline: 'none', transition: 'border-color 0.15s', background: '#fff', width: '100%',
  fontFamily: 'Inter, sans-serif', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#000', display: 'block', marginBottom: 6,
}
const primaryBtn: React.CSSProperties = {
  background: '#000', color: '#fff',
  fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
  padding: '9px 18px', borderRadius: 10, border: 'none', cursor: 'pointer', transition: 'opacity 0.15s',
}
const secondaryBtn: React.CSSProperties = {
  border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#58595B',
  fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
  padding: '9px 18px', borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s',
}
const card: React.CSSProperties = { background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 22 }
const focusHandlers = {
  onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => (e.currentTarget.style.borderColor = '#CEA4FF'),
  onBlur:  (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)'),
}

export default function Onboarding() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { selectedOperator } = useOperator()

  const [quizzes, setQuizzes]           = useState<Quiz[]>([])
  const [questionCounts, setQuestionCounts] = useState<Record<string, number>>({})
  const [myAttempts, setMyAttempts]     = useState<Record<string, Attempt>>({}) // best/last attempt per quiz
  const [articles, setArticles]         = useState<ArticleOption[]>([])
  const [loading, setLoading]           = useState(true)
  const [view, setView]                 = useState<View>('list')
  const [activeQuiz, setActiveQuiz]     = useState<Quiz | null>(null)

  useEffect(() => { loadQuizzes() }, [selectedOperator?.id, isAdmin])

  async function loadQuizzes() {
    setLoading(true)
    const opId = selectedOperator?.id ?? null
    let q = supabase.from('quizzes').select('id,title,description,source_article_id,passing_score,is_published,operator_id,updated_at').order('updated_at', { ascending: false })
    if (opId) q = (q as any).or(`operator_id.eq.${opId},operator_id.is.null`)
    if (!isAdmin) q = (q as any).eq('is_published', true)
    const { data } = await q
    const list = data ?? []
    setQuizzes(list)

    // Source-article picker: same visibility rule as Learn itself — this operator's
    // own articles plus global ones, not every operator's articles.
    let artQ = supabase.from('kb_articles').select('id,title,content').order('title')
    if (opId) artQ = (artQ as any).or(`operator_id.eq.${opId},operator_id.is.null`)

    if (list.length) {
      const ids = list.map(q => q.id)
      const [{ data: qs }, { data: atts }, { data: arts }] = await Promise.all([
        supabase.from('quiz_questions').select('id,quiz_id').in('quiz_id', ids),
        user ? supabase.from('quiz_attempts').select('id,quiz_id,user_name,user_email,score_pct,passed,completed_at').eq('user_id', user.id).in('quiz_id', ids).order('completed_at', { ascending: false }) : Promise.resolve({ data: [] }),
        artQ,
      ])
      const counts: Record<string, number> = {}
      for (const row of qs ?? []) counts[row.quiz_id] = (counts[row.quiz_id] ?? 0) + 1
      setQuestionCounts(counts)
      const lastByQuiz: Record<string, Attempt> = {}
      for (const a of (atts as Attempt[]) ?? []) if (!lastByQuiz[a.quiz_id]) lastByQuiz[a.quiz_id] = a // already ordered desc — first is latest
      setMyAttempts(lastByQuiz)
      setArticles(arts ?? [])
    } else {
      setQuestionCounts({}); setMyAttempts({})
      const { data: arts } = await artQ
      setArticles(arts ?? [])
    }
    setLoading(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this quiz and all its attempt history? This cannot be undone.')) return
    await supabase.from('quizzes').delete().eq('id', id)
    setQuizzes(qs => qs.filter(q => q.id !== id))
  }

  async function handleTogglePublish(quiz: Quiz) {
    await supabase.from('quizzes').update({ is_published: !quiz.is_published }).eq('id', quiz.id)
    setQuizzes(qs => qs.map(q => q.id === quiz.id ? { ...q, is_published: !q.is_published } : q))
  }

  if (view === 'create' || view === 'edit') {
    return (
      <QuizEditor
        quiz={view === 'edit' ? activeQuiz : null}
        articles={articles}
        onCancel={() => { setView('list'); setActiveQuiz(null) }}
        onSaved={() => { setView('list'); setActiveQuiz(null); loadQuizzes() }}
      />
    )
  }

  if (view === 'take' && activeQuiz) {
    return (
      <QuizRunner
        quiz={activeQuiz}
        onBack={() => { setView('list'); setActiveQuiz(null); loadQuizzes() }}
      />
    )
  }

  if (view === 'results' && activeQuiz) {
    return (
      <QuizResults
        quiz={activeQuiz}
        onBack={() => { setView('list'); setActiveQuiz(null) }}
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#58595B' }}>
          Agent-training quizzes — {isAdmin ? 'author and publish quizzes, optionally drafted from a Learn article' : 'take a quiz to check your understanding'}
        </p>
        {isAdmin && (
          <button onClick={() => setView('create')} style={primaryBtn}>+ New quiz</button>
        )}
      </div>

      {loading ? (
        <div style={{ ...card, padding: 48, textAlign: 'center' }}>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>Loading…</p>
        </div>
      ) : quizzes.length === 0 ? (
        <div style={{ ...card, padding: 48, textAlign: 'center' }}>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>
            {isAdmin ? 'No quizzes yet — create one to get started.' : 'No quizzes available yet.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {quizzes.map(quiz => (
            <QuizCard
              key={quiz.id}
              quiz={quiz}
              isAdmin={isAdmin}
              questionCount={questionCounts[quiz.id] ?? 0}
              lastAttempt={myAttempts[quiz.id]}
              onTake={() => { setActiveQuiz(quiz); setView('take') }}
              onEdit={() => { setActiveQuiz(quiz); setView('edit') }}
              onResults={() => { setActiveQuiz(quiz); setView('results') }}
              onDelete={() => handleDelete(quiz.id)}
              onTogglePublish={() => handleTogglePublish(quiz)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function QuizCard({ quiz, isAdmin, questionCount, lastAttempt, onTake, onEdit, onResults, onDelete, onTogglePublish }: {
  quiz: Quiz; isAdmin: boolean; questionCount: number; lastAttempt?: Attempt
  onTake: () => void; onEdit: () => void; onResults: () => void; onDelete: () => void; onTogglePublish: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <div style={{ ...card, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 100, textTransform: 'uppercase', letterSpacing: '0.06em', background: 'rgba(155,89,208,0.1)', color: '#9B59D0' }}>
            {questionCount} question{questionCount === 1 ? '' : 's'}
          </span>
          {isAdmin && quiz.operator_id === null && (
            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 100, textTransform: 'uppercase', letterSpacing: '0.06em', background: 'rgba(0,0,0,0.06)', color: '#58595B' }}>Global</span>
          )}
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 100,
              background: quiz.is_published ? 'rgba(22,101,52,0.09)' : 'rgba(0,0,0,0.06)',
              color: quiz.is_published ? '#166534' : '#58595B',
            }}>
              {quiz.is_published ? 'Published' : 'Draft'}
            </span>
            <div style={{ position: 'relative' }}>
              <button onClick={() => setMenuOpen(v => !v)} style={{ width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 16, background: 'none', border: 'none', cursor: 'pointer' }}>⋯</button>
              {menuOpen && (
                <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', right: 0, top: 28, zIndex: 10, background: '#fff', borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.09)', boxShadow: '0 8px 24px rgba(0,0,0,0.1)', minWidth: 150, overflow: 'hidden' }}>
                  {[
                    { label: 'Edit', action: onEdit, danger: false },
                    { label: quiz.is_published ? 'Unpublish' : 'Publish', action: onTogglePublish, danger: false },
                    { label: 'View results', action: onResults, danger: false },
                    { label: 'Delete', action: onDelete, danger: true },
                  ].map(item => (
                    <button key={item.label} onClick={() => { item.action(); setMenuOpen(false) }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', fontFamily: 'Inter, sans-serif', fontSize: 13, color: item.danger ? '#e53e3e' : '#000', background: 'none', border: 'none', cursor: 'pointer' }}>
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 15, fontWeight: 600, color: '#000', lineHeight: 1.4 }}>{quiz.title || 'Untitled quiz'}</p>
      {quiz.description && (
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{quiz.description}</p>
      )}

      {lastAttempt && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'Inter, sans-serif', fontSize: 12 }}>
          <span style={{ color: '#58595B' }}>Last score:</span>
          <span style={{ fontWeight: 700, color: lastAttempt.passed ? '#166534' : '#c53030' }}>{lastAttempt.score_pct}%</span>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 100, textTransform: 'uppercase', background: lastAttempt.passed ? 'rgba(22,101,52,0.09)' : 'rgba(229,62,62,0.09)', color: lastAttempt.passed ? '#166534' : '#c53030' }}>
            {lastAttempt.passed ? 'Passed' : 'Failed'}
          </span>
        </div>
      )}

      <button
        onClick={onTake}
        disabled={questionCount === 0}
        style={{ ...primaryBtn, marginTop: 'auto', opacity: questionCount === 0 ? 0.4 : 1, cursor: questionCount === 0 ? 'default' : 'pointer' }}
      >
        {questionCount === 0 ? 'No questions yet' : isAdmin && !quiz.is_published ? 'Preview' : lastAttempt ? 'Retake quiz' : 'Take quiz'}
      </button>
    </div>
  )
}

// ── Quiz editor (create / edit) ─────────────────────────────────────────────
function QuizEditor({ quiz, articles, onCancel, onSaved }: {
  quiz: Quiz | null; articles: ArticleOption[]
  onCancel: () => void; onSaved: () => void
}) {
  const { user } = useAuth()
  const { selectedOperator } = useOperator()
  const [title, setTitle]             = useState(quiz?.title ?? '')
  const [description, setDescription] = useState(quiz?.description ?? '')
  const [sourceArticleId, setSourceArticleId] = useState(quiz?.source_article_id ?? '')
  const [passingScore, setPassingScore] = useState(quiz?.passing_score ?? 70)
  const [isGlobal, setIsGlobal]       = useState(quiz ? quiz.operator_id === null : false)
  const [questions, setQuestions]     = useState<DraftQuestion[]>([])
  const [loadingQuestions, setLoadingQuestions] = useState(!!quiz)
  const [saving, setSaving]           = useState(false)
  const [generating, setGenerating]   = useState(false)
  const [genError, setGenError]       = useState('')

  useEffect(() => {
    if (!quiz) return
    supabase.from('quiz_questions').select('id,question,options,correct_index,explanation').eq('quiz_id', quiz.id).order('sort_order').then(({ data }) => {
      setQuestions((data ?? []).map(q => ({ ...q, options: q.options as string[], _key: newKey() })))
      setLoadingQuestions(false)
    })
  }, [quiz])

  const sourceArticle = articles.find(a => a.id === sourceArticleId)
  const canGenerate = !!sourceArticle && sourceArticle.content.trim().length >= 200

  function addQuestion() { setQuestions(qs => [...qs, emptyQuestion()]) }
  function removeQuestion(key: string) { setQuestions(qs => qs.filter(q => q._key !== key)) }
  function updateQuestion(key: string, patch: Partial<DraftQuestion>) {
    setQuestions(qs => qs.map(q => q._key === key ? { ...q, ...patch } : q))
  }
  function updateOption(key: string, idx: number, value: string) {
    setQuestions(qs => qs.map(q => q._key === key ? { ...q, options: q.options.map((o, i) => i === idx ? value : o) } : q))
  }

  async function handleGenerate() {
    if (!sourceArticle) return
    setGenerating(true); setGenError('')
    const { data, error } = await supabase.functions.invoke('quiz-generate', { body: { article_id: sourceArticle.id, question_count: 8 } })
    if (error || data?.error) {
      setGenError(data?.error ?? error?.message ?? 'Failed to draft questions.')
      setGenerating(false)
      return
    }
    const drafted: DraftQuestion[] = (data.questions ?? []).map((q: any) => ({
      _key: newKey(), id: '', question: q.question, options: q.options, correct_index: q.correct_index, explanation: q.explanation,
    }))
    setQuestions(qs => [...qs, ...drafted])
    setGenerating(false)
  }

  async function handleSave(publish: boolean) {
    if (!user || !title.trim() || questions.length === 0) return
    setSaving(true)
    const payload = {
      title: title.trim(), description: description.trim(),
      source_article_id: sourceArticleId || null,
      passing_score: passingScore,
      is_published: publish,
      operator_id: isGlobal ? null : (selectedOperator?.id ?? null),
      updated_by: user.email, updated_at: new Date().toISOString(),
    }
    let quizId = quiz?.id
    if (quizId) {
      const { error } = await supabase.from('quizzes').update(payload).eq('id', quizId)
      if (error) { alert(error.message); setSaving(false); return }
      await supabase.from('quiz_questions').delete().eq('quiz_id', quizId)
    } else {
      const { data, error } = await supabase.from('quizzes').insert([{ ...payload, created_by: user.email }]).select('id').single()
      if (error || !data) { alert(error?.message ?? 'Failed to create quiz'); setSaving(false); return }
      quizId = data.id
    }
    const rows = questions.map((q, i) => ({
      quiz_id: quizId, question: q.question.trim(), options: q.options, correct_index: q.correct_index, explanation: q.explanation.trim(), sort_order: i,
    }))
    const { error: qErr } = await supabase.from('quiz_questions').insert(rows)
    if (qErr) { alert(qErr.message); setSaving(false); return }
    setSaving(false)
    onSaved()
  }

  const canSave = title.trim() && questions.length > 0 && questions.every(q => q.question.trim() && q.options.every(o => o.trim()))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>{quiz ? 'Edit quiz' : 'New quiz'}</h1>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#58595B', marginTop: 4 }}>Agent-training quiz builder</p>
        </div>
        <button onClick={onCancel} style={secondaryBtn}>← Back to Onboarding</button>
      </div>

      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 14 }}>
          <div>
            <label style={labelStyle}>Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Chargeback Handling Basics" style={inputStyle} {...focusHandlers} />
          </div>
          <div>
            <label style={labelStyle}>Passing score</label>
            <div style={{ position: 'relative' }}>
              <input type="number" min={0} max={100} value={passingScore} onChange={e => setPassingScore(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))} style={{ ...inputStyle, paddingRight: 28 }} {...focusHandlers} />
              <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#aaa' }}>%</span>
            </div>
          </div>
        </div>

        <div>
          <label style={labelStyle}>Description <span style={{ fontWeight: 400, color: '#aaa' }}>(optional)</span></label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} {...focusHandlers} />
        </div>

        <div>
          <label style={labelStyle}>Source Learn article <span style={{ fontWeight: 400, color: '#aaa' }}>(optional — lets you draft questions with AI)</span></label>
          <select value={sourceArticleId} onChange={e => setSourceArticleId(e.target.value)} style={inputStyle} {...focusHandlers}>
            <option value="">No linked article</option>
            {articles.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
        </div>

        <div>
          <button
            type="button" onClick={() => setIsGlobal(g => !g)}
            style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            <span style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, border: isGlobal ? '1.5px solid #9B59D0' : '1.5px solid rgba(0,0,0,0.25)', background: isGlobal ? '#9B59D0' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {isGlobal && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
            </span>
            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#000' }}>Global quiz — visible to all clients</span>
          </button>
        </div>
      </div>

      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 15, fontWeight: 600, color: '#000' }}>Questions ({questions.length})</p>
          <div style={{ display: 'flex', gap: 8 }}>
            {canGenerate && (
              <button onClick={handleGenerate} disabled={generating} style={{ ...secondaryBtn, borderColor: '#CEA4FF', color: '#9B59D0', opacity: generating ? 0.6 : 1 }}>
                {generating ? 'Drafting…' : '✦ Draft questions from article'}
              </button>
            )}
            <button onClick={addQuestion} style={secondaryBtn}>+ Add question</button>
          </div>
        </div>
        {sourceArticleId && !canGenerate && (
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#aaa' }}>This article has no substantial text content — AI drafting needs written content, not just an uploaded file. Add questions manually.</p>
        )}
        {genError && <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#e53e3e' }}>❌ {genError}</p>}

        {loadingQuestions ? (
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#aaa' }}>Loading questions…</p>
        ) : questions.length === 0 ? (
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#aaa' }}>No questions yet — add one manually or draft from the linked article.</p>
        ) : (
          questions.map((q, qi) => (
            <div key={q._key} style={{ border: '1.5px solid rgba(0,0,0,0.09)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 6, background: '#000', color: '#fff', fontFamily: 'Manrope, sans-serif', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 6 }}>{qi + 1}</span>
                <textarea value={q.question} onChange={e => updateQuestion(q._key, { question: e.target.value })} placeholder="Question text" rows={2} style={{ ...inputStyle, resize: 'vertical', flex: 1 }} {...focusHandlers} />
                <button onClick={() => removeQuestion(q._key)} style={{ color: '#aaa', fontSize: 18, background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, flexShrink: 0, marginTop: 6 }} title="Remove question">×</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, paddingLeft: 34 }}>
                {q.options.map((opt, oi) => (
                  <div key={oi} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      type="button" onClick={() => updateQuestion(q._key, { correct_index: oi })}
                      title="Mark as correct answer"
                      style={{ flexShrink: 0, width: 20, height: 20, borderRadius: 100, border: q.correct_index === oi ? '1.5px solid #166534' : '1.5px solid rgba(0,0,0,0.25)', background: q.correct_index === oi ? '#166534' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                    >
                      {q.correct_index === oi && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                    </button>
                    <input value={opt} onChange={e => updateOption(q._key, oi, e.target.value)} placeholder={`Option ${String.fromCharCode(65 + oi)}`} style={inputStyle} {...focusHandlers} />
                  </div>
                ))}
              </div>
              <div style={{ paddingLeft: 34 }}>
                <input value={q.explanation} onChange={e => updateQuestion(q._key, { explanation: e.target.value })} placeholder="Explanation shown after answering (optional)" style={{ ...inputStyle, fontSize: 12.5 }} {...focusHandlers} />
              </div>
            </div>
          ))
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={secondaryBtn}>Cancel</button>
        <button onClick={() => handleSave(false)} disabled={!canSave || saving} style={{ ...secondaryBtn, opacity: canSave && !saving ? 1 : 0.4 }}>Save as draft</button>
        <button onClick={() => handleSave(true)} disabled={!canSave || saving} style={{ ...primaryBtn, opacity: canSave && !saving ? 1 : 0.4, cursor: canSave && !saving ? 'pointer' : 'default' }}>
          {saving ? 'Saving…' : 'Publish'}
        </button>
      </div>
    </div>
  )
}

// ── Quiz runner (take the quiz) ─────────────────────────────────────────────
function QuizRunner({ quiz, onBack }: { quiz: Quiz; onBack: () => void }) {
  const { user } = useAuth()
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading]     = useState(true)
  const [answers, setAnswers]     = useState<Record<string, number>>({})
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult]       = useState<{ score: number; passed: boolean } | null>(null)

  useEffect(() => {
    supabase.from('quiz_questions').select('id,question,options,correct_index,explanation').eq('quiz_id', quiz.id).order('sort_order').then(({ data }) => {
      setQuestions((data ?? []).map(q => ({ ...q, options: q.options as string[] })))
      setLoading(false)
    })
  }, [quiz.id])

  async function handleSubmit() {
    if (!user) return
    setSubmitting(true)
    const detailed = questions.map(q => ({ question_id: q.id, selected_index: answers[q.id] ?? -1, correct: answers[q.id] === q.correct_index }))
    const correctCount = detailed.filter(a => a.correct).length
    const score = Math.round((100 * correctCount) / questions.length)
    const passed = score >= quiz.passing_score
    await supabase.from('quiz_attempts').insert([{
      quiz_id: quiz.id, user_id: user.id, user_name: user.name, user_email: user.email,
      score_pct: score, passed, answers: detailed,
    }])
    setResult({ score, passed })
    setSubmitting(false)
  }

  if (loading) return <div style={card}><p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#aaa' }}>Loading quiz…</p></div>

  if (result) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ ...card, textAlign: 'center', padding: 40 }}>
          <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 32, fontWeight: 600, color: result.passed ? '#166534' : '#c53030' }}>{result.score}%</p>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 15, fontWeight: 600, color: result.passed ? '#166534' : '#c53030', marginTop: 4 }}>
            {result.passed ? 'Passed' : 'Not quite — review and retake'}
          </p>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', marginTop: 4 }}>Passing score: {quiz.passing_score}%</p>
        </div>
        {questions.map((q, qi) => {
          const selected = answers[q.id]
          const correct = selected === q.correct_index
          return (
            <div key={q.id} style={card}>
              <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: '#000', marginBottom: 10 }}>{qi + 1}. {q.question}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {q.options.map((opt, oi) => {
                  const isCorrectOpt = oi === q.correct_index
                  const isSelected = oi === selected
                  const bg = isCorrectOpt ? 'rgba(22,101,52,0.07)' : isSelected ? 'rgba(229,62,62,0.06)' : 'transparent'
                  const bd = isCorrectOpt ? 'rgba(22,101,52,0.3)' : isSelected ? 'rgba(229,62,62,0.3)' : 'rgba(0,0,0,0.08)'
                  const fg = isCorrectOpt ? '#166534' : isSelected ? '#c53030' : '#000'
                  return (
                    <div key={oi} style={{ padding: '8px 12px', borderRadius: 8, border: `1.5px solid ${bd}`, background: bg, fontFamily: 'Inter, sans-serif', fontSize: 13, color: fg }}>
                      {opt}{isCorrectOpt ? ' ✓' : isSelected ? ' ✗' : ''}
                    </div>
                  )
                })}
              </div>
              {q.explanation && (
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12.5, color: '#58595B', marginTop: 10, lineHeight: 1.6 }}>{q.explanation}</p>
              )}
              {!correct && <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#aaa', marginTop: 4 }}>{selected == null ? 'Not answered' : ''}</p>}
            </div>
          )
        })}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onBack} style={primaryBtn}>Back to Onboarding</button>
        </div>
      </div>
    )
  }

  const allAnswered = questions.length > 0 && questions.every(q => answers[q.id] != null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>{quiz.title}</h1>
          {quiz.description && <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#58595B', marginTop: 4 }}>{quiz.description}</p>}
        </div>
        <button onClick={onBack} style={secondaryBtn}>← Back to Onboarding</button>
      </div>

      {questions.map((q, qi) => (
        <div key={q.id} style={card}>
          <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: '#000', marginBottom: 12 }}>{qi + 1}. {q.question}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {q.options.map((opt, oi) => {
              const selected = answers[q.id] === oi
              return (
                <button
                  key={oi} onClick={() => setAnswers(a => ({ ...a, [q.id]: oi }))}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                    border: selected ? '1.5px solid #9B59D0' : '1.5px solid rgba(0,0,0,0.1)',
                    background: selected ? 'rgba(155,89,208,0.06)' : '#fff', transition: 'all 0.15s',
                  }}
                >
                  <span style={{ flexShrink: 0, width: 18, height: 18, borderRadius: 100, border: selected ? '1.5px solid #9B59D0' : '1.5px solid rgba(0,0,0,0.25)', background: selected ? '#9B59D0' : '#fff' }} />
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13.5, color: '#000' }}>{opt}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={handleSubmit} disabled={!allAnswered || submitting} style={{ ...primaryBtn, opacity: allAnswered && !submitting ? 1 : 0.4, cursor: allAnswered && !submitting ? 'pointer' : 'default' }}>
          {submitting ? 'Submitting…' : 'Submit quiz'}
        </button>
      </div>
    </div>
  )
}

// ── Results (admin) ─────────────────────────────────────────────────────────
function QuizResults({ quiz, onBack }: { quiz: Quiz; onBack: () => void }) {
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    supabase.from('quiz_attempts').select('id,quiz_id,user_name,user_email,score_pct,passed,completed_at').eq('quiz_id', quiz.id).order('completed_at', { ascending: false }).then(({ data }) => {
      setAttempts(data ?? [])
      setLoading(false)
    })
  }, [quiz.id])

  const passCount = attempts.filter(a => a.passed).length
  const uniqueAgents = new Set(attempts.map(a => a.user_email)).size

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>{quiz.title} — Results</h1>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#58595B', marginTop: 4 }}>Every attempt, most recent first</p>
        </div>
        <button onClick={onBack} style={secondaryBtn}>← Back to Onboarding</button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ padding: '6px 12px', background: 'rgba(0,0,0,0.03)', borderRadius: 8 }}>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B' }}>Attempts </span>
          <span style={{ fontFamily: 'Manrope, sans-serif', fontSize: 13, fontWeight: 600, color: '#000' }}>{attempts.length}</span>
        </div>
        <div style={{ padding: '6px 12px', background: 'rgba(0,0,0,0.03)', borderRadius: 8 }}>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B' }}>Pass rate </span>
          <span style={{ fontFamily: 'Manrope, sans-serif', fontSize: 13, fontWeight: 600, color: '#000' }}>{attempts.length ? Math.round((100 * passCount) / attempts.length) : 0}%</span>
        </div>
        <div style={{ padding: '6px 12px', background: 'rgba(0,0,0,0.03)', borderRadius: 8 }}>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#58595B' }}>Unique agents </span>
          <span style={{ fontFamily: 'Manrope, sans-serif', fontSize: 13, fontWeight: 600, color: '#000' }}>{uniqueAgents}</span>
        </div>
      </div>

      {loading ? (
        <div style={{ ...card, padding: 40, textAlign: 'center' }}><p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#aaa' }}>Loading…</p></div>
      ) : attempts.length === 0 ? (
        <div style={{ ...card, padding: 40, textAlign: 'center' }}><p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#aaa' }}>No attempts yet.</p></div>
      ) : (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          {attempts.map((a, i) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderTop: i === 0 ? 'none' : '1px solid rgba(0,0,0,0.07)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#000' }}>{a.user_name || a.user_email}</p>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#aaa' }}>{a.user_email}</p>
              </div>
              <span style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: a.passed ? '#166534' : '#c53030' }}>{a.score_pct}%</span>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 100, textTransform: 'uppercase', background: a.passed ? 'rgba(22,101,52,0.09)' : 'rgba(229,62,62,0.09)', color: a.passed ? '#166534' : '#c53030' }}>
                {a.passed ? 'Passed' : 'Failed'}
              </span>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#aaa', width: 90, textAlign: 'right' }}>{new Date(a.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
