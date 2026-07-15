import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useOperator } from '../context/OperatorContext'
import Onboarding from './Onboarding'
import AskOperator from './AskOperator'

type SubView = 'articles' | 'onboarding' | 'ask'

interface KBArticle {
  id: string
  title: string
  content: string
  category: string
  is_published: boolean
  created_by: string
  updated_by: string
  updated_at: string
  file_url:  string | null
  file_name: string | null
  file_type: string | null
  operator_id: string | null
  include_in_ask: boolean
}

type View = 'list' | 'create' | 'edit' | 'read'

const CATEGORY_COLORS: Record<string, { bg: string; color: string }> = {
  General:   { bg: 'rgba(8,145,178,0.1)',   color: '#0e7490' },
  Processes: { bg: 'rgba(206,164,255,0.18)', color: '#6b21a8' },
  SOPs:      { bg: 'rgba(22,101,52,0.1)',   color: '#166534' },
  Zendesk:   { bg: 'rgba(243,156,18,0.12)', color: '#b45309' },
}

const CATEGORIES = ['General', 'Processes', 'SOPs', 'Zendesk']

const ACCEPTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
].join(',')

function catStyle(cat: string): { bg: string; color: string } {
  return CATEGORY_COLORS[cat] ?? { bg: 'rgba(0,0,0,0.07)', color: '#58595B' }
}

function fileTypeLabel(fileType: string | null): string | null {
  if (!fileType) return null
  if (fileType.includes('pdf')) return 'PDF'
  if (fileType.includes('wordprocessingml') || fileType.includes('docx')) return 'DOCX'
  if (fileType.includes('spreadsheetml') || fileType.includes('xlsx')) return 'XLSX'
  if (fileType.includes('presentationml') || fileType.includes('pptx')) return 'PPTX'
  return 'FILE'
}

function isPdf(fileType: string | null) {
  return !!fileType?.includes('pdf')
}

function embedUrl(fileUrl: string, fileType: string | null): string {
  if (isPdf(fileType)) return fileUrl
  // Google Docs Viewer for Office formats
  return `https://docs.google.com/viewer?url=${encodeURIComponent(fileUrl)}&embedded=true`
}

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

export default function Learn() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { selectedOperator } = useOperator()

  const [subView, setSubView]   = useState<SubView>('articles')
  const [articles, setArticles] = useState<KBArticle[]>([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState('All')
  const [search, setSearch]     = useState('')
  const [view, setView]         = useState<View>('list')
  const [editTarget, setEditTarget] = useState<KBArticle | null>(null)
  const [readTarget, setReadTarget] = useState<KBArticle | null>(null)
  const [saving, setSaving]     = useState(false)

  // form fields
  const [formTitle,    setFormTitle]    = useState('')
  const [formCat,      setFormCat]      = useState('General')
  const [formBody,     setFormBody]     = useState('')
  const [formFileUrl,  setFormFileUrl]  = useState('')
  const [formFileName, setFormFileName] = useState('')
  const [formFileType, setFormFileType] = useState('')
  const [formGlobal,   setFormGlobal]   = useState(false)
  const [formIncludeInAsk, setFormIncludeInAsk] = useState(true)

  // upload state
  const [uploading,    setUploading]    = useState(false)
  const [uploadError,  setUploadError]  = useState('')
  const [uploadPct,    setUploadPct]    = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadArticles() }, [selectedOperator?.id, isAdmin])

  async function loadArticles() {
    setLoading(true)
    const opId = selectedOperator?.id ?? null
    let q = supabase
      .from('kb_articles')
      .select('id, title, content, category, is_published, created_by, updated_by, updated_at, file_url, file_name, file_type, operator_id, include_in_ask')
      .order('updated_at', { ascending: false })
    // Show operator-specific articles + global articles (operator_id = null).
    // When no operator is selected, show everything.
    if (opId) q = (q as any).or(`operator_id.eq.${opId},operator_id.is.null`)
    if (!isAdmin) q = (q as any).eq('is_published', true)
    const { data } = await q
    setArticles(data ?? [])
    setLoading(false)
  }

  function openCreate() {
    setEditTarget(null)
    setFormTitle(''); setFormCat('General'); setFormBody('')
    setFormFileUrl(''); setFormFileName(''); setFormFileType('')
    setFormGlobal(false)
    setFormIncludeInAsk(true)
    setUploadError(''); setUploadPct(0)
    setView('create')
  }

  function openEdit(a: KBArticle) {
    setEditTarget(a)
    setFormTitle(a.title); setFormCat(a.category); setFormBody(a.content)
    setFormFileUrl(a.file_url ?? ''); setFormFileName(a.file_name ?? ''); setFormFileType(a.file_type ?? '')
    setFormGlobal(a.operator_id === null)
    setFormIncludeInAsk(a.include_in_ask)
    setUploadError(''); setUploadPct(0)
    setView('edit')
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setUploadError('')
    setUploadPct(0)

    const path = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`

    const { error } = await supabase.storage
      .from('learn-docs')
      .upload(path, file, { upsert: false, contentType: file.type })

    if (error) {
      setUploadError(error.message)
      setUploading(false)
      return
    }

    const { data: urlData } = supabase.storage.from('learn-docs').getPublicUrl(path)
    setFormFileUrl(urlData.publicUrl)
    setFormFileName(file.name)
    setFormFileType(file.type)
    setUploadPct(100)
    setUploading(false)

    // clear the input so the same file can be re-selected if needed
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function clearFile() {
    setFormFileUrl(''); setFormFileName(''); setFormFileType('')
    setUploadPct(0); setUploadError('')
  }

  async function handleSave(publish: boolean) {
    if (!user || !formTitle.trim()) return
    setSaving(true)

    const payload = {
      title:        formTitle.trim(),
      category:     formCat,
      content:      formBody,
      is_published: publish,
      updated_by:   user.email,
      updated_at:   new Date().toISOString(),
      file_url:     formFileUrl  || null,
      file_name:    formFileName || null,
      file_type:    formFileType || null,
      // Global docs (operator_id null) are visible to every client; otherwise
      // scope to the active operator.
      operator_id:  formGlobal ? null : (selectedOperator?.id ?? null),
      include_in_ask: formIncludeInAsk,
    }
    let savedId: string | null = null
    if (editTarget) {
      const { error } = await supabase.from('kb_articles').update(payload).eq('id', editTarget.id)
      if (error) { alert(error.message); setSaving(false); return }
      savedId = editTarget.id
    } else {
      const { data, error } = await supabase.from('kb_articles').insert([{ ...payload, created_by: user.email }]).select('id').single()
      if (error) { alert(error.message); setSaving(false); return }
      savedId = data?.id ?? null
    }
    // Fire-and-forget — (re)builds this article's search chunks so it's
    // immediately askable in "Ask the Operator" without a separate step.
    if (savedId) supabase.functions.invoke('index-kb-article', { body: { article_id: savedId } }).catch(() => {})
    setSaving(false)
    setView('list')
    loadArticles()
  }

  async function handleTogglePublish(a: KBArticle) {
    await supabase.from('kb_articles').update({ is_published: !a.is_published }).eq('id', a.id)
    setArticles(as => as.map(x => x.id === a.id ? { ...x, is_published: !x.is_published } : x))
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this article? This cannot be undone.')) return
    await supabase.from('kb_articles').delete().eq('id', id)
    setArticles(as => as.filter(a => a.id !== id))
  }

  const categories = ['All', ...Array.from(new Set(articles.map(a => a.category))).sort()]
  const filtered   = articles.filter(a => {
    if (filter !== 'All' && a.category !== filter) return false
    if (search && !a.title.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })
  const groupedCats = Array.from(new Set(filtered.map(a => a.category))).sort()

  // ── Read view ────────────────────────────────────────────────────────────────
  if (view === 'read' && readTarget) {
    const ftLabel = fileTypeLabel(readTarget.file_type)
    const hasEmbed = !!readTarget.file_url

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <button onClick={() => { setView('list'); setReadTarget(null) }} style={{ ...secondaryBtn, marginBottom: 12 }}>
              ← Back to Learn
            </button>
            <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>
              {readTarget.title}
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <span style={{
                fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                padding: '3px 9px', borderRadius: 100,
                background: catStyle(readTarget.category).bg, color: catStyle(readTarget.category).color,
              }}>{readTarget.category}</span>
              {ftLabel && (
                <span style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
                  padding: '3px 9px', borderRadius: 100,
                  background: 'rgba(0,0,0,0.06)', color: '#58595B',
                }}>{ftLabel}</span>
              )}
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#aaa' }}>
                Updated {new Date(readTarget.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {readTarget.file_url && (
              <a
                href={readTarget.file_url}
                target="_blank"
                rel="noreferrer"
                style={{ ...secondaryBtn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
                Open in new tab
              </a>
            )}
            {isAdmin && (
              <button onClick={() => openEdit(readTarget)} style={secondaryBtn}>Edit article</button>
            )}
          </div>
        </div>

        {/* Embedded doc viewer */}
        {hasEmbed && (
          <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', overflow: 'hidden' }}>
            <iframe
              src={embedUrl(readTarget.file_url!, readTarget.file_type)}
              style={{ width: '100%', height: '78vh', border: 'none', display: 'block' }}
              title={readTarget.title}
              allow="fullscreen"
            />
          </div>
        )}

        {/* Written content (shown below embed if both exist) */}
        {readTarget.content && (
          <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 28 }}>
            <MarkdownView text={readTarget.content} />
          </div>
        )}

        {!hasEmbed && !readTarget.content && (
          <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 48, textAlign: 'center' }}>
            <em style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#aaa' }}>No content yet.</em>
          </div>
        )}
      </div>
    )
  }

  // ── Create / Edit view ───────────────────────────────────────────────────────
  if (view === 'create' || view === 'edit') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>
              {view === 'edit' ? 'Edit article' : 'New article'}
            </h1>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#58595B', marginTop: 4 }}>
              SOPs, guides, and resources for the team
            </p>
          </div>
          <button onClick={() => setView('list')} style={secondaryBtn}>← Back to Learn</button>
        </div>

        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: 14 }}>
            <div>
              <label style={labelStyle}>Title</label>
              <input
                value={formTitle}
                onChange={e => setFormTitle(e.target.value)}
                placeholder="e.g. How to Handle Chargebacks"
                style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
              />
            </div>
            <div>
              <label style={labelStyle}>Category</label>
              <select
                value={formCat}
                onChange={e => setFormCat(e.target.value)}
                style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
              >
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Visibility / scope */}
          <div>
            <label style={labelStyle}>Visibility</label>
            <button
              type="button"
              onClick={() => setFormGlobal(g => !g)}
              style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              <span style={{
                width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                border: formGlobal ? '1.5px solid #9B59D0' : '1.5px solid rgba(0,0,0,0.25)',
                background: formGlobal ? '#9B59D0' : '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
              }}>
                {formGlobal && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </span>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#000' }}>
                Global doc — visible to all clients
              </span>
            </button>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#aaa', marginTop: 6 }}>
              {formGlobal
                ? 'This article will appear in Learn for every client.'
                : `Scoped to ${selectedOperator?.name ?? 'the selected client'} only.`}
            </p>
          </div>

          {/* Ask eligibility */}
          <div>
            <label style={labelStyle}>Ask the Operator</label>
            <button
              type="button"
              onClick={() => setFormIncludeInAsk(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              <span style={{
                width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                border: formIncludeInAsk ? '1.5px solid #9B59D0' : '1.5px solid rgba(0,0,0,0.25)',
                background: formIncludeInAsk ? '#9B59D0' : '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
              }}>
                {formIncludeInAsk && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </span>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#000' }}>
                Include in Ask
              </span>
            </button>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#aaa', marginTop: 6 }}>
              On for real KB content (SOPs, house rules, process docs) that should ground Ask answers. Turn off for
              QA/agent training or testing material — it'll still live in Learn, just excluded from Ask.
            </p>
          </div>

          {/* File upload */}
          <div>
            <label style={labelStyle}>
              Document <span style={{ fontWeight: 400, color: '#aaa' }}>(PDF, DOCX, XLSX, PPTX — optional)</span>
            </label>

            {formFileUrl ? (
              /* Uploaded file pill */
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                border: '1.5px solid rgba(22,101,52,0.3)', borderRadius: 10,
                padding: '10px 14px', background: 'rgba(22,101,52,0.04)',
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#166534', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {formFileName || 'Uploaded file'}
                </span>
                <button
                  onClick={clearFile}
                  style={{ color: '#aaa', fontSize: 18, background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}
                  title="Remove file"
                >×</button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{ ...secondaryBtn, padding: '5px 12px', fontSize: 12, flexShrink: 0 }}
                >
                  Replace
                </button>
              </div>
            ) : (
              /* Drop zone / upload button */
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: '1.5px dashed rgba(206,164,255,0.6)', borderRadius: 10,
                  padding: '28px 20px', background: 'rgba(206,164,255,0.04)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                  cursor: uploading ? 'default' : 'pointer', transition: 'background 0.15s',
                }}
                onMouseEnter={e => { if (!uploading) e.currentTarget.style.background = 'rgba(206,164,255,0.09)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(206,164,255,0.04)' }}
              >
                {uploading ? (
                  <>
                    <div style={{ width: '100%', maxWidth: 220, height: 4, borderRadius: 100, background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                      <div style={{ width: `${uploadPct}%`, height: '100%', background: '#9B59D0', borderRadius: 100, transition: 'width 0.3s' }} />
                    </div>
                    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#9B59D0', margin: 0 }}>Uploading…</p>
                  </>
                ) : (
                  <>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#CEA4FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="16 16 12 12 8 16"/>
                      <line x1="12" y1="12" x2="12" y2="21"/>
                      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
                    </svg>
                    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#58595B', margin: 0 }}>
                      Click to upload a file
                    </p>
                    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#aaa', margin: 0 }}>
                      PDF, DOCX, XLSX, PPTX
                    </p>
                  </>
                )}
              </div>
            )}

            {uploadError && (
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#e53e3e', marginTop: 6 }}>{uploadError}</p>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
          </div>

          <div>
            <label style={labelStyle}>Article content <span style={{ fontWeight: 400, color: '#aaa' }}>(optional if file uploaded)</span></label>
            <textarea
              value={formBody}
              onChange={e => setFormBody(e.target.value)}
              placeholder="Write your article here…"
              rows={10}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.7, minHeight: 200 }}
              onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
            />
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => setView('list')} style={secondaryBtn}>Cancel</button>
            <button
              onClick={() => handleSave(false)}
              disabled={!formTitle || saving || uploading}
              style={{ ...secondaryBtn, opacity: formTitle && !saving && !uploading ? 1 : 0.4 }}
            >
              Save as draft
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={!formTitle || saving || uploading}
              style={{ ...primaryBtn, opacity: formTitle && !saving && !uploading ? 1 : 0.4, cursor: formTitle && !saving && !uploading ? 'pointer' : 'default' }}
            >
              {saving ? 'Saving…' : 'Publish'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Onboarding sub-view ─────────────────────────────────────────────────────
  if (subView === 'onboarding') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>Learn</h1>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#58595B', marginTop: 4 }}>
              SOPs, guides, and resources for the team
            </p>
          </div>
          <SubNavTabs subView={subView} setSubView={setSubView} />
        </div>
        <Onboarding />
      </div>
    )
  }

  // ── Ask sub-view ─────────────────────────────────────────────────────────────
  if (subView === 'ask') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>Learn</h1>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#58595B', marginTop: 4 }}>
              SOPs, guides, and resources for the team
            </p>
          </div>
          <SubNavTabs subView={subView} setSubView={setSubView} />
        </div>
        <AskOperator
          onOpenArticle={articleId => {
            const found = articles.find(a => a.id === articleId)
            if (found) { setReadTarget(found); setView('read') }
          }}
        />
      </div>
    )
  }

  // ── List view ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>Learn</h1>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#58595B', marginTop: 4 }}>
            SOPs, guides, and resources for the team
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <SubNavTabs subView={subView} setSubView={setSubView} />
          {isAdmin && (
            <button onClick={openCreate} style={primaryBtn}>+ New article</button>
          )}
        </div>
      </div>

      {/* Search + category filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: 260 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <circle cx="11" cy="11" r="8" stroke="#aaa" strokeWidth="1.7"/>
            <path d="M21 21l-4.35-4.35" stroke="#aaa" strokeWidth="1.7" strokeLinecap="round"/>
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search articles…"
            style={{ ...inputStyle, paddingLeft: 32 }}
            onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
            onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
          />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {categories.map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
              padding: '7px 14px', borderRadius: 100, cursor: 'pointer',
              background: filter === f ? '#000' : '#fff',
              color: filter === f ? '#fff' : '#58595B',
              border: filter === f ? '1.5px solid #000' : '1.5px solid rgba(0,0,0,0.12)',
              transition: 'all 0.15s',
            }}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 48, textAlign: 'center' }}>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>Loading…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 48, textAlign: 'center' }}>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>No articles found</p>
        </div>
      ) : (
        groupedCats.map(cat => (
          <div key={cat}>
            <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 16, fontWeight: 600, color: '#000', marginBottom: 12 }}>{cat}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {filtered.filter(a => a.category === cat).map(article => (
                <ArticleCard
                  key={article.id}
                  article={article}
                  isAdmin={isAdmin}
                  onRead={() => { setReadTarget(article); setView('read') }}
                  onEdit={() => openEdit(article)}
                  onDelete={() => handleDelete(article.id)}
                  onToggle={() => handleTogglePublish(article)}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function SubNavTabs({ subView, setSubView }: { subView: SubView; setSubView: (v: SubView) => void }) {
  return (
    <div style={{ display: 'flex', gap: 2, padding: 4, background: 'rgba(0,0,0,0.05)', borderRadius: 12, alignSelf: 'flex-start' }}>
      {(['articles', 'onboarding', 'ask'] as SubView[]).map(tab => (
        <button
          key={tab}
          onClick={() => setSubView(tab)}
          style={{
            fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
            padding: '7px 18px', borderRadius: 9, border: 'none', cursor: 'pointer',
            background: subView === tab ? '#fff' : 'transparent',
            color: subView === tab ? '#000' : '#58595B',
            boxShadow: subView === tab ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
            transition: 'all 0.15s',
          }}
        >
          {tab === 'articles' ? 'Articles' : tab === 'onboarding' ? 'Onboarding' : 'Ask'}
        </button>
      ))}
    </div>
  )
}

// ── Lightweight Markdown renderer for KB article content ──────────────────────
// Supports # / ## / ### headings, **bold**, `code`, - and 1. lists, > callouts,
// --- rules, and | pipe | tables. Single newlines inside a paragraph are kept as
// line breaks, so legacy plain-text articles still render correctly.
function renderInline(text: string, kp: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0, m: RegExpExecArray | null, i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('**')) out.push(<strong key={`${kp}b${i}`} style={{ fontWeight: 700 }}>{t.slice(2, -2)}</strong>)
    else out.push(<code key={`${kp}c${i}`} style={{ fontFamily: 'monospace', fontSize: '0.92em', background: 'rgba(0,0,0,0.05)', padding: '1px 5px', borderRadius: 4 }}>{t.slice(1, -1)}</code>)
    last = m.index + t.length; i++
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function MarkdownView({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: React.ReactNode[] = []
  let i = 0, key = 0
  const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l)
  const isSep = (l: string) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes('-')
  const isSpecial = (l: string) =>
    /^\s*$/.test(l) || /^(#{1,3})\s+/.test(l) || /^\s*(---+|===+)\s*$/.test(l) ||
    /^\s*[-*]\s+/.test(l) || /^\s*\d+\.\s+/.test(l) || /^\s*>\s?/.test(l) || isRow(l)

  while (i < lines.length) {
    const line = lines[i]
    if (/^\s*$/.test(line)) { i++; continue }

    const h = line.match(/^(#{1,3})\s+(.*)$/)
    if (h) {
      const lvl = h[1].length
      const size = lvl === 1 ? 22 : lvl === 2 ? 17 : 14
      blocks.push(<div key={key++} style={{ fontFamily: 'Manrope, sans-serif', fontWeight: 600, color: '#000', fontSize: size, margin: lvl === 1 ? '4px 0 12px' : '22px 0 8px' }}>{renderInline(h[2], `h${key}`)}</div>)
      i++; continue
    }
    if (/^\s*(---+|===+)\s*$/.test(line)) { blocks.push(<hr key={key++} style={{ border: 'none', borderTop: '1.5px solid rgba(0,0,0,0.1)', margin: '18px 0' }} />); i++; continue }

    if (isRow(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const header = line.split('|').slice(1, -1).map(s => s.trim())
      i += 2
      const rows: string[][] = []
      while (i < lines.length && isRow(lines[i])) { rows.push(lines[i].split('|').slice(1, -1).map(s => s.trim())); i++ }
      blocks.push(
        <table key={key++} style={{ borderCollapse: 'collapse', width: '100%', margin: '12px 0', fontFamily: 'Inter, sans-serif', fontSize: 13 }}>
          <thead><tr>{header.map((c, ci) => <th key={ci} style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid rgba(0,0,0,0.12)', color: '#58595B', fontWeight: 600 }}>{renderInline(c, `th${key}_${ci}`)}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} style={{ padding: '8px 12px', borderBottom: '1px solid rgba(0,0,0,0.07)', color: '#000', verticalAlign: 'top' }}>{renderInline(c, `td${key}_${ri}_${ci}`)}</td>)}</tr>)}</tbody>
        </table>
      )
      continue
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++ }
      blocks.push(<ul key={key++} style={{ margin: '8px 0', paddingLeft: 22, fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#000', lineHeight: 1.7 }}>{items.map((it, ii) => <li key={ii} style={{ marginBottom: 4 }}>{renderInline(it, `ul${key}_${ii}`)}</li>)}</ul>)
      continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++ }
      blocks.push(<ol key={key++} style={{ margin: '8px 0', paddingLeft: 22, fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#000', lineHeight: 1.7 }}>{items.map((it, ii) => <li key={ii} style={{ marginBottom: 4 }}>{renderInline(it, `ol${key}_${ii}`)}</li>)}</ol>)
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { items.push(lines[i].replace(/^\s*>\s?/, '')); i++ }
      blocks.push(<blockquote key={key++} style={{ margin: '12px 0', padding: '12px 16px', borderLeft: '3px solid #9B59D0', background: 'rgba(155,89,208,0.06)', borderRadius: '0 8px 8px 0', fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#000', lineHeight: 1.7 }}>{items.map((l, li) => <span key={li}>{renderInline(l, `bq${key}_${li}`)}{li < items.length - 1 ? <br /> : null}</span>)}</blockquote>)
      continue
    }

    const para: string[] = []
    while (i < lines.length && !isSpecial(lines[i])) { para.push(lines[i]); i++ }
    blocks.push(<p key={key++} style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#000', lineHeight: 1.8, margin: '0 0 12px' }}>{para.map((l, li) => <span key={li}>{renderInline(l, `p${key}_${li}`)}{li < para.length - 1 ? <br /> : null}</span>)}</p>)
  }
  return <>{blocks}</>
}

function ArticleCard({ article, isAdmin, onRead, onEdit, onDelete, onToggle }: {
  article: KBArticle; isAdmin: boolean
  onRead: () => void; onEdit: () => void; onDelete: () => void; onToggle: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const cs = catStyle(article.category)
  const ftLabel = fileTypeLabel(article.file_type)
  const preview = article.content
    ? article.content.replace(/#{1,6}\s/g, '').replace(/\*\*/g, '').replace(/\*/g, '').trim().slice(0, 120)
    : ''

  return (
    <div
      onClick={onRead}
      style={{
        background: '#fff', borderRadius: 14,
        border: '1.5px solid rgba(0,0,0,0.09)', padding: 18,
        display: 'flex', flexDirection: 'column', gap: 10,
        cursor: 'pointer', position: 'relative', transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'rgba(206,164,255,0.5)'
        e.currentTarget.style.boxShadow = '0 4px 16px rgba(206,164,255,0.12)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'rgba(0,0,0,0.09)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{
            fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 700,
            padding: '3px 8px', borderRadius: 100, textTransform: 'uppercase', letterSpacing: '0.06em',
            background: cs.bg, color: cs.color,
          }}>{article.category}</span>
          {ftLabel && (
            <span style={{
              fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 700,
              padding: '3px 8px', borderRadius: 100, textTransform: 'uppercase', letterSpacing: '0.06em',
              background: 'rgba(0,0,0,0.06)', color: '#58595B',
            }}>{ftLabel}</span>
          )}
          {isAdmin && article.operator_id === null && (
            <span style={{
              fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 700,
              padding: '3px 8px', borderRadius: 100, textTransform: 'uppercase', letterSpacing: '0.06em',
              background: 'rgba(155,89,208,0.12)', color: '#9B59D0',
            }}>Global</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isAdmin && (
            <span style={{
              fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600,
              padding: '3px 8px', borderRadius: 100,
              background: article.is_published ? 'rgba(22,101,52,0.09)' : 'rgba(0,0,0,0.06)',
              color: article.is_published ? '#166534' : '#58595B',
            }}>
              {article.is_published ? 'Published' : 'Draft'}
            </span>
          )}
          {isAdmin && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={e => { e.stopPropagation(); setMenuOpen(v => !v) }}
                style={{
                  width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#aaa', fontSize: 16, background: 'none', border: 'none', cursor: 'pointer', transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.07)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >⋯</button>
              {menuOpen && (
                <div
                  onClick={e => e.stopPropagation()}
                  style={{
                    position: 'absolute', right: 0, top: 28, zIndex: 10,
                    background: '#fff', borderRadius: 10,
                    border: '1.5px solid rgba(0,0,0,0.09)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
                    minWidth: 140, overflow: 'hidden',
                  }}
                >
                  {[
                    { label: 'Edit', action: onEdit, danger: false },
                    { label: article.is_published ? 'Unpublish' : 'Publish', action: onToggle, danger: false },
                    { label: 'Delete', action: onDelete, danger: true },
                  ].map(item => (
                    <button key={item.label} onClick={() => { item.action(); setMenuOpen(false) }} style={{
                      display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px',
                      fontFamily: 'Inter, sans-serif', fontSize: 13,
                      color: item.danger ? '#e53e3e' : '#000',
                      background: 'none', border: 'none', cursor: 'pointer', transition: 'background 0.1s',
                    }}
                      onMouseEnter={e => (e.currentTarget.style.background = item.danger ? 'rgba(229,62,62,0.06)' : 'rgba(0,0,0,0.04)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >{item.label}</button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: '#000', lineHeight: 1.4 }}>
        {article.title}
      </p>

      {preview ? (
        <p style={{
          fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', lineHeight: 1.5,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {preview}{article.content.length > 120 ? '…' : ''}
        </p>
      ) : article.file_name ? (
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#9B59D0', lineHeight: 1.5 }}>
          📄 {article.file_name}
        </p>
      ) : null}

      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#aaa', marginTop: 'auto' }}>
        Updated {new Date(article.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </p>
    </div>
  )
}
