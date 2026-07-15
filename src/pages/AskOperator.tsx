import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useOperator } from '../context/OperatorContext'

interface Source { id: string; title: string }
interface Message {
  role: 'user' | 'assistant'
  text: string
  sources?: Source[]
  coverage?: 'full' | 'partial' | 'none'
  excludedCount?: number
}

interface CommonQuestion { sample_question: string; ask_count: number }

interface Props {
  onOpenArticle: (articleId: string) => void
}

const COMMON_QUESTIONS_WINDOW_DAYS = 30

export default function AskOperator({ onOpenArticle }: Props) {
  const { user } = useAuth()
  const { selectedOperator } = useOperator()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput]       = useState('')
  const [asking, setAsking]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [commonQuestions, setCommonQuestions] = useState<CommonQuestion[]>([])

  // Asking about a different operator with stale answers from another
  // operator still visible would be misleading — clear on switch.
  useEffect(() => {
    setMessages([])
    setError(null)
    setCommonQuestions([])
    if (!selectedOperator) return
    const since = new Date(Date.now() - COMMON_QUESTIONS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
    supabase.rpc('common_asked_questions', { match_operator_id: selectedOperator.id, since, result_limit: 8 })
      .then(({ data }) => setCommonQuestions(data ?? []))
  }, [selectedOperator?.id])

  async function handleAsk(questionOverride?: string) {
    const question = (questionOverride ?? input).trim()
    if (!question || !selectedOperator || asking) return
    setAsking(true)
    setError(null)
    setMessages(m => [...m, { role: 'user', text: question }])
    setInput('')
    try {
      const { data, error: fnError } = await supabase.functions.invoke('ask-operator', {
        body: { operator_id: selectedOperator.id, question, user_id: user?.id ?? null },
      })
      if (fnError) {
        let message = fnError.message ?? 'Something went wrong.'
        const resp: Response | undefined = fnError.context
        if (resp) {
          try {
            const body = await resp.clone().json()
            if (body?.error) message = body.error
          } catch {
            // body wasn't JSON — fall back to the generic message
          }
        }
        setError(message)
      } else if (data?.error) {
        setError(data.error)
      } else {
        setMessages(m => [...m, {
          role: 'assistant', text: data.answer ?? '', sources: data.sources ?? [],
          coverage: data.coverage, excludedCount: data.excluded_count ?? 0,
        }])
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to reach the assistant.')
    } finally {
      setAsking(false)
    }
  }

  if (!selectedOperator) {
    return (
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 48, textAlign: 'center' }}>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>
          Select an operator to ask about.
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{
        background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)',
        padding: 24, display: 'flex', flexDirection: 'column', gap: 16, minHeight: 320,
      }}>
        {messages.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>
              Ask anything about {selectedOperator.name}'s SOPs, house rules, or process docs — answers are
              grounded only in what's published in Learn for {selectedOperator.name}.
            </p>
            {commonQuestions.length > 0 && (
              <div>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: '#58595B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
                  Commonly asked
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {commonQuestions.map((cq, i) => (
                    <button
                      key={i}
                      onClick={() => handleAsk(cq.sample_question)}
                      disabled={asking}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                        textAlign: 'left', fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000',
                        padding: '8px 12px', borderRadius: 8, cursor: asking ? 'default' : 'pointer',
                        border: '1px solid rgba(0,0,0,0.09)', background: '#fff', transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => { if (!asking) e.currentTarget.style.background = 'rgba(206,164,255,0.06)' }}
                      onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                    >
                      <span>{cq.sample_question}</span>
                      <span style={{ flexShrink: 0, fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#aaa' }}>
                        Asked {cq.ask_count}×
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
              {m.role === 'user' ? (
                <div style={{
                  background: '#000', color: '#fff', borderRadius: 12, padding: '10px 14px',
                  fontFamily: 'Inter, sans-serif', fontSize: 13,
                }}>
                  {m.text}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {m.coverage && m.coverage !== 'full' && (
                    <div style={{
                      fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500,
                      color: '#b45309', background: 'rgba(243,156,18,0.1)',
                      padding: '5px 10px', borderRadius: 8, alignSelf: 'flex-start',
                    }}>
                      {m.coverage === 'none' ? "Not covered in this operator's KB" : 'Only partially covered'}
                    </div>
                  )}
                  <div style={{
                    background: 'rgba(206,164,255,0.06)', border: '1px solid rgba(0,0,0,0.08)',
                    borderRadius: 12, padding: '12px 14px',
                    fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#000',
                    lineHeight: 1.6, whiteSpace: 'pre-wrap',
                  }}>
                    {m.text}
                  </div>
                  {m.sources && m.sources.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {m.sources.map(s => (
                        <button
                          key={s.id}
                          onClick={() => onOpenArticle(s.id)}
                          style={{
                            fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 500,
                            padding: '3px 10px', borderRadius: 100, cursor: 'pointer',
                            border: '1px solid rgba(155,89,208,0.3)', background: 'rgba(155,89,208,0.06)',
                            color: '#9B59D0',
                          }}
                        >
                          {s.title}
                        </button>
                      ))}
                    </div>
                  )}
                  {!!m.excludedCount && (
                    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#aaa' }}>
                      {m.excludedCount} document(s) for this operator couldn't be read (Word/Excel/PowerPoint uploads).
                    </p>
                  )}
                </div>
              )}
            </div>
          ))
        )}
        {asking && (
          <div style={{ alignSelf: 'flex-start', fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(0,0,0,0.35)' }}>
            Thinking…
          </div>
        )}
      </div>

      {error && (
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#e53e3e' }}>{error}</p>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk() } }}
          placeholder={`Ask about ${selectedOperator.name}'s SOPs…`}
          rows={2}
          disabled={asking}
          style={{
            border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 10,
            padding: '9px 12px', fontSize: 13, color: '#000', outline: 'none',
            transition: 'border-color 0.15s', background: '#fff', flex: 1,
            fontFamily: 'Inter, sans-serif', resize: 'vertical', boxSizing: 'border-box',
          }}
          onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
          onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
        />
        <button
          onClick={() => handleAsk()}
          disabled={!input.trim() || asking}
          style={{
            background: '#000', color: '#fff',
            fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
            padding: '9px 18px', borderRadius: 10, border: 'none',
            cursor: input.trim() && !asking ? 'pointer' : 'default',
            opacity: input.trim() && !asking ? 1 : 0.4, transition: 'opacity 0.15s',
          }}
        >
          {asking ? 'Asking…' : 'Ask'}
        </button>
      </div>
    </div>
  )
}
